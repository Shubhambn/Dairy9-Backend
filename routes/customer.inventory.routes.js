import express from "express";
import auth from "../middlewares/auth.js";
import { getCustomerInventory } from "../controllers/customer.inventory.controller.js";

const router = express.Router();

// router.use(auth);

// Customer gets only assigned retailer’s inventory
router.get("/", getCustomerInventory);

export default router;
