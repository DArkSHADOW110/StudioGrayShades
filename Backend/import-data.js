/**
 * import-data.js
 * One-off migration: reads data.json and inserts all records into Supabase.
 *
 * Usage (from the Backend/ folder):
 *   node import-data.js
 *
 * Requires: Backend/.env with SUPABASE_URL and SUPABASE_ANON_KEY
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ── Init ──────────────────────────────────────────────────────────────────────
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const dataPath = path.join(__dirname, 'data.json');
if (!fs.existsSync(dataPath)) {
    console.error('❌  data.json not found at:', dataPath);
    process.exit(1);
}

const raw = fs.readFileSync(dataPath, 'utf-8');
const data = JSON.parse(raw);

// ── Helpers ───────────────────────────────────────────────────────────────────
function toNum(v) {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
}

async function upsertBatch(table, rows) {
    if (!rows || rows.length === 0) {
        console.log(`  ⏭  ${table}: no rows, skipping.`);
        return;
    }
    const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
    if (error) {
        console.error(`  ❌  ${table}: ${error.message}`);
    } else {
        console.log(`  ✅  ${table}: ${rows.length} row(s) imported.`);
    }
}

// ── Map functions (data.json → Supabase schema) ───────────────────────────────

function mapCustomers(customers) {
    return customers.map(c => ({
        id:        c.id,
        name:      c.name || '',
        phone:     c.phone || '',
        createdAt: c.createdAt || new Date().toISOString(),
    }));
}

function mapFramingOrders(orders) {
    return orders.map(o => ({
        id:                 o.id,
        customerId:         o.customerId || null,
        description:        o.description || '',
        colorLabel:         o.colorLabel || '',
        deliveryDate:       o.deliveryDate || '',
        additionalServices: o.additionalServices || [],
        totalPrice:         toNum(o.totalPrice),
        advancePaid:        toNum(o.advancePaid),
        balance:            toNum(o.balance),
        notes:              o.notes || '',
        status:             o.status || 'Pending',
        customerName:       o.customerName || '',
        phone:              o.phone || '',
        price:              toNum(o.price || o.totalPrice),
        advance:            toNum(o.advance || o.advancePaid),
        createdAt:          o.createdAt || new Date().toISOString(),
        updatedAt:          o.updatedAt || null,
    }));
}

function mapShootBookings(bookings) {
    return bookings.map(o => ({
        id:                 o.id,
        customerId:         o.customerId || null,
        customerName:       o.customerName || '',
        phone:              o.phone || '',
        eventType:          o.eventType || '',
        date:               o.date || '',
        time:               o.time || '',
        location:           o.location || '',
        colorLabel:         o.colorLabel || '',
        enlargement:        o.enlargement ? String(o.enlargement) : '',
        album:              o.album || '',
        thankYouCards:      o.thankYouCards || '',
        additionalServices: o.additionalServices || [],
        note1:              o.note1 || '',
        note2:              o.note2 || '',
        totalPrice:         toNum(o.totalPrice),
        advancePaid:        toNum(o.advancePaid),
        balance:            toNum(o.balance),
        status:             o.status || 'Booked',
        price:              toNum(o.price || o.totalPrice),
        advance:            toNum(o.advance || o.advancePaid),
        createdAt:          o.createdAt || new Date().toISOString(),
        updatedAt:          o.updatedAt || null,
    }));
}

function mapEditingOrders(orders) {
    return orders.map(o => ({
        id:                 o.id,
        customerId:         o.customerId || null,
        customerName:       o.customerName || '',
        phone:              o.phone || '',
        title:              o.title || '',
        deliveryDate:       o.deliveryDate || '',
        additionalServices: o.additionalServices || [],
        totalPrice:         toNum(o.totalPrice),
        advancePaid:        toNum(o.advancePaid),
        balance:            toNum(o.balance),
        note1:              o.note1 || '',
        note2:              o.note2 || '',
        status:             o.status || 'Pending',
        colorLabel:         o.colorLabel || '',
        price:              toNum(o.price || o.totalPrice),
        advance:            toNum(o.advance || o.advancePaid),
        createdAt:          o.createdAt || new Date().toISOString(),
        updatedAt:          o.updatedAt || null,
    }));
}

function mapExpenditures(items) {
    return items.map(o => ({
        id:        o.id,
        date:      o.date || '',
        title:     o.title || '',
        note:      o.note || '',
        price:     toNum(o.price),
        createdAt: o.createdAt || new Date().toISOString(),
        updatedAt: o.updatedAt || null,
    }));
}

function mapNotes(notes) {
    return notes.map(o => ({
        id:          o.id,
        title:       o.title || '',
        description: o.description || '',
        date:        o.date || new Date().toISOString(),
        updatedAt:   o.updatedAt || null,
    }));
}

function mapUnsettledOrders(orders) {
    return orders.map(o => ({
        id:                 o.id,
        customerName:       o.customerName || '',
        date:               o.date || '',
        phone:              o.phone || '',
        title:              o.title || '',
        additionalServices: o.additionalServices || [],
        totalPrice:         toNum(o.totalPrice),
        advancePaid:        toNum(o.advancePaid),
        balance:            toNum(o.balance),
        createdAt:          o.createdAt || new Date().toISOString(),
        updatedAt:          o.updatedAt || null,
    }));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n🚀  Studio GrayShades — Data Import\n');

    await upsertBatch('customers',       mapCustomers(data.customers || []));
    await upsertBatch('framing_orders',  mapFramingOrders(data.framing_orders || []));
    await upsertBatch('shoot_bookings',  mapShootBookings(data.shoot_bookings || []));
    await upsertBatch('editing_orders',  mapEditingOrders(data.editing_orders || []));
    await upsertBatch('expenditures',    mapExpenditures(data.expenditures || []));
    await upsertBatch('notes',           mapNotes(data.notes || []));
    await upsertBatch('unsettled_orders', mapUnsettledOrders(data.unsettled_orders || []));

    console.log('\n✅  Import complete!\n');
}

main().catch(err => {
    console.error('\n❌  Unexpected error:', err.message);
    process.exit(1);
});
