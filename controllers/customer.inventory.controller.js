import Customer from "../models/customer.model.js";
import RetailerInventory from "../models/retailerInventory.model.js";

/**
 * GET /api/customer/inventory
 * Returns normalized, compact inventory for the customer's assigned retailer.
 */
export const getCustomerInventory = async (req, res) => {
  try {
    // 1) Fetch the logged-in customer's profile
    const customer = await Customer.findOne({ user: req.user._id }).lean();

    if (!customer) {
      return res.json({ success: true, data: { inventory: [] } });
    }

    // 2) Check if retailer assigned
    if (!customer.assignedRetailer) {
      console.log("⚠ No retailer assigned for customer");
      return res.json({ success: true, data: { inventory: [] } });
    }

    const retailerId = customer.assignedRetailer;
    console.log("📦 Fetching inventory for retailer:", retailerId);

    // 3) Fetch retailer's inventory and populate only the product fields we need
    // Select a minimal product projection to reduce payload size and avoid deep nesting
    const inventoryDocs = await RetailerInventory.find({
      retailer: retailerId,
      isActive: true
    })
      .populate({
        path: "product",
        // pick the canonical fields. Add 'sku' or 'barcodeId' if your schema uses different field names.
        select: "_id id name price discountedPrice barcodeId sku image unit unitSize isAvailable",
      })
      .lean();

    console.log("📦 Inventory count:", inventoryDocs.length);

    // 4) Normalize / flatten inventory entries for frontend consumption
    const inventory = inventoryDocs.map(inv => {
      const prod = inv.product || {};

      // canonical product id: prefer product._id, fallback to product.id
      const productId = prod._id ? String(prod._id) : (prod.id ? String(prod.id) : null);

      // try to surface a canonical SKU / barcode if you have it (useful for client matching)
      const sku = prod.sku || prod.barcodeId || prod.barcode || null;

      return {
        // inventory-level fields
        inventoryId: inv._id ? String(inv._id) : null,
        retailer: inv.retailer ? String(inv.retailer) : null,
        currentStock: typeof inv.currentStock !== "undefined" ? Number(inv.currentStock) : null,
        committedStock: typeof inv.committedStock !== "undefined" ? Number(inv.committedStock) : null,
        sellingPrice: typeof inv.sellingPrice !== "undefined" ? Number(inv.sellingPrice) : null,
        costPrice: typeof inv.costPrice !== "undefined" ? Number(inv.costPrice) : null,
        isActive: !!inv.isActive,
        lastUpdated: inv.updatedAt || inv.lastUpdated || inv.createdAt || null,

        // flattened product info (minimal)
        product: {
          productId,
          catalogId: prod.id || null, // sometimes product has 'id' field
          sku,
          name: prod.name || inv.productName || null,
          image: prod.image || null,
          price: typeof prod.price !== "undefined" ? Number(prod.price) : null,
          discountedPrice: typeof prod.discountedPrice !== "undefined" ? Number(prod.discountedPrice) : null,
          isAvailable: typeof prod.isAvailable === "boolean" ? prod.isAvailable : true,
          unit: prod.unit || null,
          unitSize: prod.unitSize || null,
        }
      };
    });

    // 5) Return normalized array
    return res.json({
      success: true,
      data: { inventory }
    });

  } catch (err) {
    console.error("❌ Customer Inventory Error:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching customer inventory",
      error: err.message
    });
  }
};
