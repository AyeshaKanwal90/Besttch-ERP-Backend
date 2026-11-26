-- The inventory table (quantity per product and warehouse) was never used:
-- stock is counted from in_stock rows in "items". Nothing reads it, so drop it.

-- DropForeignKey
ALTER TABLE "inventory" DROP CONSTRAINT "inventory_product_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory" DROP CONSTRAINT "inventory_warehouse_id_fkey";

-- DropTable
DROP TABLE "inventory";
