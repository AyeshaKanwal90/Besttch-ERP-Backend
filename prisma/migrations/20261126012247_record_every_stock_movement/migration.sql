-- CreateEnum
CREATE TYPE "MovementReason" AS ENUM ('receive', 'sale', 'removal', 'damage', 'return', 'transfer', 'correction');

-- AlterEnum
ALTER TYPE "ItemStatus" ADD VALUE 'damaged';

-- DropIndex
DROP INDEX "stock_movements_product_id_idx";

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "from_warehouse_id" INTEGER,
ADD COLUMN     "item_id" INTEGER,
-- Temporary default so the column can be added to a table with rows;
-- it is dropped below, so new rows must always say why stock moved.
ADD COLUMN     "reason" "MovementReason" NOT NULL DEFAULT 'correction',
ADD COLUMN     "to_warehouse_id" INTEGER,
ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "stock_movements_product_id_created_at_idx" ON "stock_movements"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_item_id_idx" ON "stock_movements"("item_id");

-- CreateIndex
CREATE INDEX "stock_movements_user_id_idx" ON "stock_movements"("user_id");

-- CreateIndex
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ALTER COLUMN "reason" DROP DEFAULT;

-- Opening balances: one "receive" movement for every item already in
-- stock, dated when the item was added, so the ledger adds up to current
-- stock from the start. user_id is NULL because the system recorded them.
INSERT INTO "stock_movements"
  ("product_id", "warehouse_id", "item_id", "user_id", "type", "reason", "quantity", "reference", "note", "created_at")
SELECT
  i."product_id", i."warehouse_id", i."id", NULL, 'in', 'receive', 1, 'opening-balance',
  'Opening balance: item was in stock when movement tracking started', i."created_at"
FROM "items" i
WHERE i."status" = 'in_stock';
