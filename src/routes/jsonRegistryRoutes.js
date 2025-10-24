// src/routes/jsonRegistryRoutes.js
import express from "express";
import { getByName } from "../controllers/jsonRegistryController.js";

const router = express.Router();

// name based route
router.get("/json/:name", getByName);

export default router;
