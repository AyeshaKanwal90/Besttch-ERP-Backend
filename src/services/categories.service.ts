import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";

interface CategoryInput {
  name: string;
  slug?: string;
  parentId?: number | null;
}

const categorySelect = {
  id: true,
  name: true,
  slug: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: { where: { deletedAt: null } }, children: true } },
} as const;

function formatCategory(category: {
  _count: { products: number; children: number };
  [key: string]: unknown;
}) {
  const { _count, ...data } = category;
  return { ...data, productCount: _count.products, childCount: _count.children };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** Flat list ordered by name; the client builds the tree from parentId. */
export async function listCategories() {
  const categories = await prisma.category.findMany({ select: categorySelect, orderBy: { name: "asc" } });
  return categories.map(formatCategory);
}

export async function getCategoryById(id: number) {
  const category = await prisma.category.findUnique({ where: { id }, select: categorySelect });
  if (!category) throw ApiError.notFound("Category not found");
  return formatCategory(category);
}

export async function createCategory(input: CategoryInput) {
  const slug = await resolveSlug(input.slug ?? input.name);
  if (input.parentId) await assertCategoryExists(input.parentId, "parentId");

  const category = await prisma.category.create({
    data: { name: input.name, slug, parentId: input.parentId ?? null },
    select: categorySelect,
  });
  return formatCategory(category);
}

export async function updateCategory(id: number, input: Partial<CategoryInput>) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Category not found");

  const slug = input.slug !== undefined ? await resolveSlug(input.slug, id) : undefined;

  if (input.parentId) {
    await assertCategoryExists(input.parentId, "parentId");
    await assertNotDescendant(id, input.parentId);
  }

  const category = await prisma.category.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(slug !== undefined ? { slug } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    },
    select: categorySelect,
  });
  return formatCategory(category);
}

/**
 * Products in a deleted category become uncategorised. A category with
 * sub-categories can't be deleted until they are moved or deleted.
 */
export async function deleteCategory(id: number) {
  const existing = await prisma.category.findUnique({
    where: { id },
    select: { _count: { select: { children: true } } },
  });
  if (!existing) throw ApiError.notFound("Category not found");

  if (existing._count.children > 0) {
    throw ApiError.unprocessable("Category cannot be deleted", {
      category: [`It has ${existing._count.children} sub-categor${existing._count.children === 1 ? "y" : "ies"}`],
    });
  }

  await prisma.category.delete({ where: { id } });
}

export async function assertCategoryExists(id: number, field = "categoryId") {
  const category = await prisma.category.findUnique({ where: { id }, select: { id: true } });
  if (!category) {
    throw ApiError.unprocessable("Validation failed", { [field]: ["Category does not exist"] });
  }
}

async function resolveSlug(source: string, excludeId?: number) {
  const slug = slugify(source);
  if (!slug) {
    throw ApiError.unprocessable("Validation failed", { slug: ["Slug must contain letters or numbers"] });
  }
  const clash = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
  if (clash && clash.id !== excludeId) {
    throw ApiError.unprocessable("Validation failed", { slug: ["A category with this slug already exists"] });
  }
  return slug;
}

/** A category can't be moved under itself or one of its own sub-categories. */
async function assertNotDescendant(id: number, newParentId: number) {
  let current: number | null = newParentId;
  const seen = new Set<number>();
  while (current !== null) {
    if (current === id) {
      throw ApiError.unprocessable("Validation failed", {
        parentId: ["A category can't be placed under itself or its own sub-category"],
      });
    }
    if (seen.has(current)) break;
    seen.add(current);
    const parent: { parentId: number | null } | null = await prisma.category.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    current = parent?.parentId ?? null;
  }
}
