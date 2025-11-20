// controllers/stockOrders.controller.js
import mongoose from 'mongoose';
import StockOrder from '../models/stockOrder.model.js';
import Stock from '../models/stock.model.js';
import StockTransaction from '../models/stockTransaction.model.js';
import Product from '../models/product.model.js';
import notify from '../services/notify.js';
import { v4 as uuidv4 } from 'uuid';

const SUPERADMIN_LOCATION_TYPE = 'superadmin';
const RETAILER_LOCATION_TYPE = 'retailer';

const genOrderNumber = () => `SORD-${new Date().toISOString().slice(0,10)}-${Math.floor(Math.random()*9000)+1000}`;

// ----------------- Retailer endpoints -----------------
export const createStockOrder = async (req, res) => {
  try {
    const retailerId = req.user._id;
    const { items = [], priority = 'normal', metadata } = req.body;
    if (!items.length) return res.status(400).json({ message: 'No items' });

    const prodIds = items.map(i => i.product);
    const prods = await Product.find({ _id: { $in: prodIds } });
    const itemsClean = items.map(i => {
      const p = prods.find(x => String(x._id) === String(i.product));
      return {
        product: i.product,
        requestedQty: i.requestedQty || i.qty || 0,
        unitPrice: i.unitPrice ?? (p ? p.unitPrice : 0),
        note: i.note || ''
      };
    });

    const order = new StockOrder({
      orderNumber: genOrderNumber(),
      retailer: retailerId,
      createdBy: retailerId,
      items: itemsClean,
      priority,
      metadata
    });

    await order.save();

    // notify superadmin (safe)
    notify(req, process.env.SUPERADMIN_SOCKET_ROOM || 'superadmin:1', 'stock-order:new', {
      id: order._id,
      orderNumber: order.orderNumber,
      priority
    });

    return res.status(201).json(order);
  } catch (err) {
    console.error('createStockOrder', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

export const getRetailerStockOrders = async (req, res) => {
  try {
    const retailerId = req.user._id;
    const { page = 1, limit = 20, status } = req.query;
    const q = { retailer: retailerId };
    if (status) q.status = status;
    const orders = await StockOrder.find(q)
      .sort({ createdAt: -1 })
      .skip((page-1)*limit).limit(parseInt(limit))
      .populate('items.product', 'name sku');
    const total = await StockOrder.countDocuments(q);
    res.json({ orders, total });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const getRetailerStockOrderById = async (req, res) => {
  try {
    const id = req.params.id;
    const order = await StockOrder.findById(id).populate('items.product', 'name sku');
    if (!order) return res.status(404).json({ message: 'Not found' });
    if (String(order.retailer) !== String(req.user._id) && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const cancelStockOrder = async (req, res) => {
  try {
    const id = req.params.id;
    const order = await StockOrder.findById(id);
    if (!order) return res.status(404).json({ message: 'Not found' });
    if (String(order.retailer) !== String(req.user._id)) return res.status(403).json({ message: 'Forbidden' });
    if (!['pending','reserved'].includes(order.status)) return res.status(400).json({ message: 'Cannot cancel at this stage' });
    order.status = 'cancelled';
    order.logs.push({ by: req.user._id, action: 'cancelled', note: req.body.reason || '', at: new Date() });
    await order.save();

    notify(req, process.env.SUPERADMIN_SOCKET_ROOM || 'superadmin:1', 'stock-order:updated', { id: order._id, status: order.status });

    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const addNoteToStockOrder = async (req, res) => {
  try {
    const id = req.params.id;
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: 'Note required' });
    const order = await StockOrder.findById(id);
    if (!order) return res.status(404).json({ message: 'Not found' });
    order.notes.push({ by: req.user._id, role: req.user.role || 'retailer', text, at: new Date() });
    await order.save();

    notify(req, `retailer:${order.retailer}`, 'stock-order:note', { id: order._id, text });
    notify(req, process.env.SUPERADMIN_SOCKET_ROOM || 'superadmin:1', 'stock-order:note', { id: order._id, text });

    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ----------------- SuperAdmin endpoints -----------------
export const getStockOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, retailer } = req.query;
    const q = {};
    if (status) q.status = status;
    if (retailer) q.retailer = retailer;
    const orders = await StockOrder.find(q)
      .sort({ createdAt: -1 })
      .skip((page-1)*limit).limit(parseInt(limit))
      .populate('items.product', 'name sku')
      .populate('retailer', 'name email');
    const total = await StockOrder.countDocuments(q);
    res.json({ orders, total });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const getStockOrderById = async (req, res) => {
  try {
    const id = req.params.id;
    const order = await StockOrder.findById(id)
      .populate('items.product', 'name sku')
      .populate('retailer', 'name email');
    if (!order) return res.status(404).json({ message: 'Not found' });
    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const lockStockOrder = async (req, res) => {
  try {
    const id = req.params.id;
    const userId = req.user._id;
    const lockTTLms = (parseInt(process.env.ORDER_LOCK_TTL_MS) || (5*60*1000));
    const order = await StockOrder.findById(id);
    if (!order) return res.status(404).json({ message: 'Not found' });
    if (order.isLocked && order.lockedBy && String(order.lockedBy) !== String(userId) && order.lockExpiresAt && order.lockExpiresAt > new Date()) {
      return res.status(423).json({ message: 'Locked by another session' });
    }
    order.isLocked = true;
    order.lockedBy = userId;
    order.lockExpiresAt = new Date(Date.now() + lockTTLms);
    order.status = order.status === 'pending' ? 'locked' : order.status;
    order.logs.push({ by: userId, action: 'lock', note: 'locked for processing', at: new Date() });
    await order.save();

    notify(req, process.env.SUPERADMIN_SOCKET_ROOM || 'superadmin:1', 'stock-order:locked', { id: order._id, lockedBy: userId, expiresAt: order.lockExpiresAt });

    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const releaseStockOrderLock = async (req, res) => {
  try {
    const id = req.params.id;
    const userId = req.user._id;
    const order = await StockOrder.findById(id);
    if (!order) return res.status(404).json({ message: 'Not found' });
    if (order.isLocked && order.lockedBy && String(order.lockedBy) !== String(userId) && !req.user.isSuperAdmin) {
      return res.status(403).json({ message: 'Not lock owner' });
    }
    order.isLocked = false;
    order.lockedBy = null;
    order.lockExpiresAt = null;
    order.logs.push({ by: userId, action: 'release-lock', note: req.body.note || '', at: new Date() });
    await order.save();

    notify(req, process.env.SUPERADMIN_SOCKET_ROOM || 'superadmin:1', 'stock-order:released', { id: order._id });

    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// controllers/stockOrders.controller.js
// (only show the modified function; keep other imports as they are)
export const superAdminActOnOrder = async (req, res) => {
  const { action, items = [], reason, idempotencyKey } = req.body;
  const orderId = req.params.id;
  const superAdminId = req.user._id;

  // If idempotencyKey provided and we've already processed a transaction for this order with the same key -> return existing status
  if (idempotencyKey) {
    const already = await StockTransaction.findOne({ orderRef: orderId, traceId: idempotencyKey });
    if (already) {
      const existingOrder = await StockOrder.findById(orderId);
      return res.status(200).json({ message: 'Request already processed', order: existingOrder });
    }
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const order = await StockOrder.findById(orderId).session(session);
    if (!order) { await session.abortTransaction(); return res.status(404).json({ message: 'Not found' }); }

    // lock enforcement
    if (order.isLocked && order.lockedBy && String(order.lockedBy) !== String(superAdminId) && order.lockExpiresAt && order.lockExpiresAt > new Date()) {
      await session.abortTransaction();
      return res.status(423).json({ message: 'Order locked by another session' });
    }

    // quick path: reject/cancel
    if (action === 'reject' || action === 'cancel') {
      order.status = action === 'reject' ? 'rejected' : 'cancelled';
      order.logs.push({ by: superAdminId, action, note: reason || '', at: new Date() });
      order.isLocked = false; order.lockedBy = null; order.lockExpiresAt = null;
      await order.save({ session });
      await session.commitTransaction();

      notify(req, `retailer:${order.retailer}`, 'stock-order:updated', { id: order._id, status: order.status, note: reason });
      return res.json(order);
    }

    // Process items — NOTE: no superadmin stock checks or decrements
    for (const orderItem of order.items) {
      const requested = orderItem.requestedQty || 0;
      const override = items.find(i => String(i.product) === String(orderItem.product));
      // determine how much to fulfill for this item
      const requestedFulfill = override && typeof override.fulfilledQty === 'number'
        ? Math.min(override.fulfilledQty, requested - (orderItem.fulfilledQty || 0))
        : (requested - (orderItem.fulfilledQty || 0));
      if (requestedFulfill <= 0) continue;

      // Here: we no longer fetch or decrement a superadmin Stock doc.
      // Assume SuperAdmin can fulfill requestedFulfill (business rule).
      const toFulfill = requestedFulfill;

      // increment retailer stock (upsert)
      await Stock.findOneAndUpdate(
        { product: orderItem.product, locationType: RETAILER_LOCATION_TYPE, locationRef: order.retailer },
        { $inc: { quantity: toFulfill }, $set: { updatedAt: new Date() } },
        { upsert: true, new: true, session }
      );

      // append fulfilled qty to order item
      orderItem.fulfilledQty = (orderItem.fulfilledQty || 0) + toFulfill;

      // create StockTransaction (idempotent by unique index on orderRef+traceId)
      const traceId = idempotencyKey || uuidv4();
      try {
        await StockTransaction.create([{
          product: orderItem.product,
          from: 'superadmin',
          fromRef: superAdminId,
          to: 'retailer',
          toRef: order.retailer,
          qty: toFulfill,
          type: 'transfer',
          orderRef: order._id,
          orderRefModel: 'StockOrder',
          traceId,
          note: `Fulfilled by SuperAdmin ${superAdminId}`
        }], { session });
      } catch (txErr) {
        if (txErr.code === 11000) {
          // duplicate traceId — skip (already processed)
          console.warn('Duplicate traceId transaction skipped', traceId);
        } else {
          throw txErr;
        }
      }
    }

    // compute totals
    const totalRequested = order.items.reduce((s, it) => s + (it.requestedQty || 0), 0);
    const totalFulfilled = order.items.reduce((s, it) => s + (it.fulfilledQty || 0), 0);

    if (totalFulfilled === 0) order.status = 'rejected';
    else if (totalFulfilled < totalRequested) order.status = 'partially_fulfilled';
    else order.status = 'fulfilled';

    // clear lock and log action
    order.isLocked = false;
    order.lockedBy = null;
    order.lockExpiresAt = null;
    order.logs.push({ by: superAdminId, action: action === 'approve' ? 'approved' : 'fulfilled', note: reason || '', at: new Date() });

    await order.save({ session });
    await session.commitTransaction();

    // notify both parties
    notify(req, `retailer:${order.retailer}`, 'stock-order:updated', { id: order._id, status: order.status });
    notify(req, process.env.SUPERADMIN_SOCKET_ROOM || 'superadmin:1', 'stock-order:updated', { id: order._id, status: order.status });

    return res.json(order);
  } catch (err) {
    try { await session.abortTransaction(); } catch (e) {}
    console.error('superAdminActOnOrder err', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  } finally {
    session.endSession();
  }
};


export const getStockOrderTransactions = async (req, res) => {
  try {
    const orderId = req.params.id;
    const txs = await StockTransaction.find({ orderRef: orderId }).sort({ createdAt: -1 });
    res.json(txs);
  } catch (err) { res.status(500).json({ message: err.message }); }
};
