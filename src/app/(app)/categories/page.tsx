import { PageHeader } from "@/components/nav";
import { CategoryManager } from "@/components/category-manager";

export const metadata = { title: "Categories" };

export default function CategoriesPage() {
  return (
    <>
      <PageHeader title="Categories" subtitle="Organize spending and automate with rules" />
      <CategoryManager />
    </>
  );
}
