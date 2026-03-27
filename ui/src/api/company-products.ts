import { api } from "./client.js";

export interface CompanyProduct {
  id: string;
  companyId: string;
  type: "product" | "service";
  name: string;
  description?: string | null;
  category?: string | null;
  unit?: string | null;
  priceB2b?: string | null;
  priceB2c?: string | null;
  currency: string;
  available: boolean;
  stockQty?: string | null;
  vatRate?: string | null;
  sku?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const companyProductsApi = {
  list: (companyId: string) =>
    api.get<CompanyProduct[]>(`/company-products?companyId=${companyId}`),

  create: (data: { companyId: string } & Partial<Omit<CompanyProduct, "id" | "companyId" | "createdAt" | "updatedAt">>) =>
    api.post<CompanyProduct>("/company-products", data),

  update: (id: string, data: Partial<Omit<CompanyProduct, "id" | "companyId" | "createdAt" | "updatedAt">>) =>
    api.put<CompanyProduct>(`/company-products/${id}`, data),

  remove: (id: string, companyId: string) =>
    api.delete<void>(`/company-products/${id}?companyId=${companyId}`),

  importCsv: (companyId: string, csvText: string) =>
    api.post<{ imported: number }>("/company-products/import", { companyId, csvText }),
};
