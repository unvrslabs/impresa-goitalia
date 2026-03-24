import { Router } from "express";
import multer from "multer";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";

interface SocialPost {
  id: string;
  platform: string;
  type: string;
  text: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  permalink?: string;
  timestamp: string;
  accountName: string;
  likes?: number;
  comments?: number;
}

export function socialRoutes(db: Db) {
  const router = Router();

  router.get("/social/posts", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const platform = req.query.platform as string;
    if (!companyId) { res.json({ posts: [] }); return; }

    const posts: SocialPost[] = [];

    // Fetch Instagram + Facebook posts
    if (!platform || platform === "instagram" || platform === "facebook") {
      const metaSecret = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "meta_tokens")))
        .then((rows) => rows[0]);

      if (metaSecret?.description) {
        try {
          const meta = JSON.parse(decrypt(metaSecret.description));

          // Instagram posts
          if (!platform || platform === "instagram") {
            for (const ig of (meta.instagram || [])) {
              try {
                const r = await fetch(`https://graph.facebook.com/v21.0/${ig.id}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=20`, { headers: { Authorization: "Bearer " + meta.accessToken } });
                if (r.ok) {
                  const data = await r.json() as { data?: any[] };
                  for (const post of (data.data || [])) {
                    posts.push({
                      id: "ig_" + post.id,
                      platform: "instagram",
                      type: post.media_type === "VIDEO" ? "video" : post.media_type === "CAROUSEL_ALBUM" ? "carousel" : "image",
                      text: post.caption || "",
                      mediaUrl: post.media_url,
                      thumbnailUrl: post.thumbnail_url,
                      permalink: post.permalink,
                      timestamp: post.timestamp,
                      accountName: "@" + ig.username,
                      likes: post.like_count,
                      comments: post.comments_count,
                    });
                  }
                }
              } catch (err) { console.error("IG fetch error:", err); }
            }
          }

          // Facebook page posts
          if (!platform || platform === "facebook") {
            for (const page of (meta.pages || [])) {
              try {
                const r = await fetch(`https://graph.facebook.com/v21.0/${page.id}/posts?fields=id,message,full_picture,permalink_url,created_time,likes.summary(true),comments.summary(true)&limit=20`, { headers: { Authorization: "Bearer " + (page.accessToken || meta.accessToken) } });
                if (r.ok) {
                  const data = await r.json() as { data?: any[] };
                  for (const post of (data.data || [])) {
                    posts.push({
                      id: "fb_" + post.id,
                      platform: "facebook",
                      type: post.full_picture ? "image" : "text",
                      text: post.message || "",
                      mediaUrl: post.full_picture,
                      permalink: post.permalink_url,
                      timestamp: post.created_time,
                      accountName: page.name,
                      likes: post.likes?.summary?.total_count,
                      comments: post.comments?.summary?.total_count,
                    });
                  }
                }
              } catch (err) { console.error("FB fetch error:", err); }
            }
          }
        } catch {}
      }
    }

    // LinkedIn posts
    if (!platform || platform === "linkedin") {
      const liSecret = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "linkedin_tokens")))
        .then((rows) => rows[0]);

      if (liSecret?.description) {
        try {
          const li = JSON.parse(decrypt(liSecret.description));
          // Get posts from LinkedIn (v2/shares - works with w_member_social)
          const authorUrn = "urn:li:person:" + li.sub;
          const r = await fetch(`https://api.linkedin.com/v2/shares?q=owners&owners=${encodeURIComponent(authorUrn)}&count=20`, {
            headers: { Authorization: "Bearer " + li.accessToken, "X-Restli-Protocol-Version": "2.0.0" },
          });
          if (r.ok) {
            const data = await r.json() as { elements?: any[] };
            for (const post of (data.elements || [])) {
              const text = post.text?.text || post.specificContent?.["com.linkedin.ugc.ShareContent"]?.shareCommentary?.text || "";
              const media = post.content?.contentEntities?.[0];
              posts.push({
                id: "li_" + (post.id || post.activity || ""),
                platform: "linkedin",
                type: media?.entityLocation ? "image" : "text",
                text,
                mediaUrl: media?.entityLocation || undefined,
                permalink: `https://www.linkedin.com/feed/update/${post.activity || post.id || ""}`,
                timestamp: new Date(post.created?.time || post.lastModified?.time || Date.now()).toISOString(),
                accountName: li.name || "LinkedIn",
              });
            }
          } else {
            const errText = await r.text();
            console.error("LinkedIn fetch posts error:", r.status, errText);
          }
        } catch (err) { console.error("LinkedIn fetch error:", err); }
      }
    }

    // Sort by timestamp desc
    posts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({ posts });
  });


  // POST /social/publish - Publish a post to selected platforms
  const socialUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  router.post("/social/publish", socialUpload.single("image"), async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, text, platforms } = req.body as { companyId: string; text: string; platforms: string };
    const image = (req as any).file;
    if (!companyId || !text) { res.status(400).json({ error: "Testo richiesto" }); return; }

    let targetPlatforms: string[] = [];
    try { targetPlatforms = JSON.parse(platforms || "[]"); } catch { targetPlatforms = []; }
    console.log("[social/publish] targets:", targetPlatforms, "text:", text?.slice(0, 50), "hasImage:", !!image);
    const results: Array<{ platform: string; success: boolean; error?: string }> = [];

    // Facebook
    if (targetPlatforms.some((p) => p.startsWith("fb_"))) {
      try {
        const metaSecret = await db.select().from(companySecrets)
          .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "meta_tokens")))
          .then((rows) => rows[0]);
        if (metaSecret?.description) {
          const meta = JSON.parse(decrypt(metaSecret.description));
          for (const p of targetPlatforms.filter((t) => t.startsWith("fb_"))) {
            const pageId = p.replace("fb_", "");
            const page = (meta.pages || []).find((pg: any) => pg.id === pageId);
            if (page) {
              const token = page.accessToken || meta.accessToken;
              if (image) {
                // Photo post
                const fd = new FormData();
                fd.append("source", new Blob([image.buffer], { type: image.mimetype }), image.originalname);
                fd.append("caption", text);
                fd.append("access_token", token);
                const r = await fetch("https://graph.facebook.com/v21.0/" + pageId + "/photos", { method: "POST", body: fd });
                results.push({ platform: "facebook:" + page.name, success: r.ok, error: r.ok ? undefined : await r.text() });
              } else {
                // Text post
                const r = await fetch("https://graph.facebook.com/v21.0/" + pageId + "/feed?message=" + encodeURIComponent(text) + "&access_token=" + token, { method: "POST" });
                results.push({ platform: "facebook:" + page.name, success: r.ok, error: r.ok ? undefined : await r.text() });
              }
            }
          }
        }
      } catch (err) { results.push({ platform: "facebook", success: false, error: String(err) }); }
    }

    // Instagram (requires image URL - we publish to FB page first then IG)
    if (targetPlatforms.some((p) => p.startsWith("ig_"))) {
      try {
        const metaSecret = await db.select().from(companySecrets)
          .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "meta_tokens")))
          .then((rows) => rows[0]);
        if (metaSecret?.description) {
          const meta = JSON.parse(decrypt(metaSecret.description));
          for (const p of targetPlatforms.filter((t) => t.startsWith("ig_"))) {
            const igUsername = p.replace("ig_", "");
            const ig = (meta.instagram || []).find((i: any) => i.username === igUsername);
            if (ig && image) {
              // Instagram requires a public image URL - upload to FB page first
              const page = (meta.pages || []).find((pg: any) => pg.id === ig.pageId) || (meta.pages || [])[0];
              if (page) {
                // Upload photo unpublished to get URL
                const fd = new FormData();
                fd.append("source", new Blob([image.buffer], { type: image.mimetype }), image.originalname);
                fd.append("published", "false");
                fd.append("access_token", page.accessToken || meta.accessToken);
                const uploadRes = await fetch("https://graph.facebook.com/v21.0/" + page.id + "/photos", { method: "POST", body: fd });
                if (uploadRes.ok) {
                  const uploadData = await uploadRes.json() as { id: string };
                  // Get the image URL
                  const photoRes = await fetch("https://graph.facebook.com/v21.0/" + uploadData.id + "?fields=images&access_token=" + (page.accessToken || meta.accessToken));
                  const photoData = await photoRes.json() as { images?: Array<{ source: string }> };
                  const imageUrl = photoData.images?.[0]?.source;
                  if (imageUrl) {
                    // Create IG media container
                    const containerRes = await fetch("https://graph.facebook.com/v21.0/" + ig.id + "/media", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ image_url: imageUrl, caption: text, access_token: meta.accessToken }),
                    });
                    if (containerRes.ok) {
                      const container = await containerRes.json() as { id: string };
                      // Wait for container to be ready (poll status)
                      let ready = false;
                      for (let attempt = 0; attempt < 10; attempt++) {
                        await new Promise((r) => setTimeout(r, 2000));
                        const statusRes = await fetch("https://graph.facebook.com/v21.0/" + container.id + "?fields=status_code&access_token=" + meta.accessToken);
                        if (statusRes.ok) {
                          const statusData = await statusRes.json() as { status_code?: string };
                          if (statusData.status_code === "FINISHED") { ready = true; break; }
                          if (statusData.status_code === "ERROR") break;
                        }
                      }
                      if (ready) {
                        const pubRes = await fetch("https://graph.facebook.com/v21.0/" + ig.id + "/media_publish", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ creation_id: container.id, access_token: meta.accessToken }),
                        });
                        results.push({ platform: "instagram:@" + igUsername, success: pubRes.ok, error: pubRes.ok ? undefined : await pubRes.text() });
                      } else {
                        results.push({ platform: "instagram:@" + igUsername, success: false, error: "Media non pronto dopo 20s" });
                      }
                    } else { results.push({ platform: "instagram:@" + igUsername, success: false, error: "Container creation failed: " + await containerRes.text() }); }
                  }
                }
              }
            } else if (!image) {
              results.push({ platform: "instagram:@" + igUsername, success: false, error: "Instagram richiede un'immagine" });
            }
          }
        }
      } catch (err) { results.push({ platform: "instagram", success: false, error: String(err) }); }
    }

    // LinkedIn
    if (targetPlatforms.some((p) => p.startsWith("li_"))) {
      try {
        const liSecret = await db.select().from(companySecrets)
          .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "linkedin_tokens")))
          .then((rows) => rows[0]);
        if (liSecret?.description) {
          const li = JSON.parse(decrypt(liSecret.description));
          // Use LinkedIn Posts API (v2)
          const authorUrn = "urn:li:person:" + li.sub;
          const liHeaders = {
            Authorization: "Bearer " + li.accessToken,
            "Content-Type": "application/json",
            "LinkedIn-Version": "202601",
            "X-Restli-Protocol-Version": "2.0.0",
          };

          let imageUrn = "";
          if (image) {
            // Step 1: Initialize image upload
            const initRes = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
              method: "POST",
              headers: liHeaders,
              body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
            });
            if (initRes.ok) {
              const initData = await initRes.json() as { value?: { uploadUrl?: string; image?: string } };
              const uploadUrl = initData.value?.uploadUrl;
              imageUrn = initData.value?.image || "";
              if (uploadUrl) {
                // Step 2: Upload binary image
                await fetch(uploadUrl, {
                  method: "PUT",
                  headers: { Authorization: "Bearer " + li.accessToken, "Content-Type": image.mimetype },
                  body: image.buffer,
                });
              }
            }
          }

          const body: any = {
            author: authorUrn,
            commentary: text,
            visibility: "PUBLIC",
            distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
            lifecycleState: "PUBLISHED",
          };
          if (imageUrn) {
            body.content = {
              media: { title: "Post", id: imageUrn },
            };
          }
          const r = await fetch("https://api.linkedin.com/rest/posts", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + li.accessToken,
              "Content-Type": "application/json",
              "LinkedIn-Version": "202601",
              "X-Restli-Protocol-Version": "2.0.0",
            },
            body: JSON.stringify(body),
          });
          const respText = r.ok ? "" : await r.text();
          console.log("[linkedin] publish status:", r.status, respText || "OK");
          results.push({ platform: "linkedin", success: r.ok || r.status === 201, error: (r.ok || r.status === 201) ? undefined : respText });
        }
      } catch (err) { results.push({ platform: "linkedin", success: false, error: String(err) }); }
    }

    res.json({ results });
  });

  return router;
}
