require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl      = process.env.SUPABASE_URL;
const supabaseAnonKey  = process.env.SUPABASE_ANON_KEY;
const supabaseRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

const DEFAULT_ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
];

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
    .concat(DEFAULT_ALLOWED_ORIGINS);

// Two clients:
// - supabaseAdmin: uses service role key → bypasses RLS for all data operations
// - supabaseAuth:  uses anon key → used only to verify user login tokens
let supabaseAdmin;
let supabaseAuth;

function getSupabase() {
    if (!supabaseAdmin) {
        if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error('Supabase credentials missing. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
        }
        supabaseAdmin = createClient(supabaseUrl, supabaseRoleKey, {
            auth: { persistSession: false }
        });
    }
    return supabaseAdmin;
}

function getAuthClient() {
    if (!supabaseAuth) {
        supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
    }
    return supabaseAuth;
}

const app = express();

app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    credentials: true
}));

app.use(express.json());
app.use(express.static(__dirname + '/../Frontend'));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later.' }
});

async function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Unauthorized: missing Bearer token' });
        }

        const token = authHeader.slice(7).trim();
        if (!token) {
            return res.status(401).json({ message: 'Unauthorized: empty token' });
        }

        const { data, error } = await getAuthClient().auth.getUser(token);
        if (error || !data.user) {
            return res.status(401).json({ message: 'Unauthorized: invalid or expired token' });
        }

        req.user = data.user;
        return next();
    } catch (err) {
        const cause = err.cause?.message || err.message || '';
        if (cause.includes('ENOTFOUND') || /your_project/i.test(supabaseUrl || '')) {
            console.error('Auth middleware error: cannot reach Supabase. Check SUPABASE_URL in Backend/.env');
            return res.status(503).json({
                message: 'Server misconfigured: cannot reach Supabase. Set SUPABASE_URL in Backend/.env and restart.'
            });
        }
        console.error('Auth middleware error:', err);
        return res.status(401).json({ message: 'Unauthorized' });
    }
}

app.use('/api', apiLimiter, requireAuth);

const ORDER_TABLES = {
    framing: 'framing_orders',
    shoot: 'shoot_bookings',
    editing: 'editing_orders'
};

async function maxIdFromTable(table) {
    const { data, error } = await getSupabase()
        .from(table)
        .select('id')
        .order('id', { ascending: false })
        .limit(1);

    if (error) throw error;
    return data && data.length > 0 ? Number(data[0].id) || 0 : 0;
}

async function nextId() {
    const ids = await Promise.all([
        maxIdFromTable('customers'),
        maxIdFromTable('framing_orders'),
        maxIdFromTable('shoot_bookings'),
        maxIdFromTable('editing_orders')
    ]);
    const max = ids.length ? Math.max(...ids) : 1000000000;
    const next = max + 1;
    return next > 9999999999 ? next : Math.max(next, 1000000001);
}

async function nextExpenditureId() {
    const max = await maxIdFromTable('expenditures');
    const floor = 2000000000;
    return max >= floor ? max + 1 : floor + 1;
}

async function nextUnsettledOrderId() {
    const max = await maxIdFromTable('unsettled_orders');
    const floor = 3000000000;
    return max >= floor ? max + 1 : floor + 1;
}

async function findCustomerByPhone(phone) {
    const { data, error } = await getSupabase()
        .from('customers')
        .select('*')
        .eq('phone', phone)
        .limit(1);

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
}

async function findCustomerByPhoneAndName(phone, name) {
    const { data, error } = await getSupabase()
        .from('customers')
        .select('*')
        .eq('phone', phone)
        .eq('name', name)
        .limit(1);

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
}

async function createCustomer(name, phone) {
    const customer = {
        id: await nextId(),
        name,
        phone,
        createdAt: new Date().toISOString()
    };
    const { error } = await getSupabase().from('customers').insert(customer);
    if (error) throw error;
    return customer;
}

async function fetchAllCustomers() {
    const { data, error } = await getSupabase().from('customers').select('*');
    if (error) throw error;
    return data || [];
}

async function fetchOrdersFromTable(table) {
    const { data, error } = await getSupabase().from(table).select('*');
    if (error) throw error;
    return data || [];
}

function normalizeAdditionalServicesFramingShoot(additionalServices) {
    return Array.isArray(additionalServices)
        ? additionalServices
            .map(s => ({
                description: String((s && (s.description || s.name)) || '').trim(),
                amount: Number((s && (s.amount ?? s.price)) || 0)
            }))
            .filter(s => s.description || s.amount > 0)
        : [];
}

function normalizeUnsettledServices(additionalServices) {
    return Array.isArray(additionalServices)
        ? additionalServices
            .map(s => ({
                description: String(s.description || '').trim(),
                price: Number(s.price || 0)
            }))
            .filter(s => s.description || s.price > 0)
        : [];
}

// API: Get Dashboard Stats
app.get('/api/dashboard', async (req, res) => {
    try {
        const [framing_orders, shoot_bookings, editing_orders, expenditures] = await Promise.all([
            fetchOrdersFromTable('framing_orders'),
            fetchOrdersFromTable('shoot_bookings'),
            fetchOrdersFromTable('editing_orders'),
            fetchOrdersFromTable('expenditures')
        ]);

        let todaySales = 0;
        let pendingPayments = 0;
        let newOrders = 0;
        let readyToDeliver = 0;

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const labels = [];
        const monthlyRevenue = [0, 0, 0, 0, 0, 0];

        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            labels.push(monthNames[d.getMonth()]);
        }

        const countStatsAndRevenue = (orders) => {
            if (!orders) return;
            orders.forEach(order => {
                const orderTotal = Number(order.totalPrice || 0);
                const orderAdvance = Number(order.advancePaid || order.advance || 0);
                const orderDate = new Date(order.createdAt || order.date);

                todaySales += orderAdvance;
                pendingPayments += Number(order.balance || 0);
                if (['Pending', 'Booked'].includes(order.status)) newOrders++;
                if (['Ready', 'Edited', 'Completed'].includes(order.status)) readyToDeliver++;

                if (!isNaN(orderDate.getTime())) {
                    const diffMonths = (now.getFullYear() - orderDate.getFullYear()) * 12 + (now.getMonth() - orderDate.getMonth());
                    if (diffMonths >= 0 && diffMonths < 6) {
                        const index = 5 - diffMonths;
                        monthlyRevenue[index] += orderTotal;
                    }
                }
            });
        };

        countStatsAndRevenue(framing_orders);
        countStatsAndRevenue(shoot_bookings);
        countStatsAndRevenue(editing_orders);

        const totalExpenditures = expenditures.reduce((sum, exp) => {
            const expTotal = Number(exp.price || 0);
            const expDate = new Date(exp.date || exp.createdAt);
            if (!isNaN(expDate.getTime())) {
                const diffMonths = (now.getFullYear() - expDate.getFullYear()) * 12 + (now.getMonth() - expDate.getMonth());
                if (diffMonths >= 0 && diffMonths < 6) {
                    const index = 5 - diffMonths;
                    monthlyRevenue[index] -= expTotal;
                }
            }
            return sum + expTotal;
        }, 0);

        const totalRevenue =
            framing_orders.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0) +
            shoot_bookings.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0) +
            editing_orders.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0);

        const netRevenue = totalRevenue - totalExpenditures;

        res.json({
            todaySales,
            pendingPayments,
            newOrders,
            readyToDeliver,
            totalRevenue,
            totalExpenditures,
            netRevenue,
            chartData: {
                labels,
                data: monthlyRevenue
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Get All Expenditures (newest first)
app.get('/api/expenditures', async (req, res) => {
    try {
        const { data, error } = await getSupabase().from('expenditures').select('*');
        if (error) throw error;

        const expenditures = Array.isArray(data) ? data : [];
        expenditures.sort((a, b) => {
            const bDate = new Date(b.date || b.createdAt || 0).getTime();
            const aDate = new Date(a.date || a.createdAt || 0).getTime();
            return bDate - aDate;
        });

        res.json(expenditures);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Add Expenditure
app.post('/api/expenditures', async (req, res) => {
    try {
        const { date, title, note, price } = req.body || {};

        if (!date || !title || price === undefined || price === null || Number(price) < 0) {
            return res.status(400).json({ message: 'date, title and valid price are required.' });
        }

        const newExpenditure = {
            id: await nextExpenditureId(),
            date,
            title: String(title).trim(),
            note: String(note || '').trim(),
            price: Number(price),
            createdAt: new Date().toISOString()
        };

        const { error } = await getSupabase().from('expenditures').insert(newExpenditure);
        if (error) throw error;

        res.status(201).json({
            message: 'Expenditure saved successfully!',
            expenditure: newExpenditure
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Update Expenditure
app.put('/api/expenditures/:id', async (req, res) => {
    try {
        const expenseId = Number(req.params.id);
        const { date, title, note, price } = req.body || {};

        const { data: existing, error: fetchError } = await getSupabase()
            .from('expenditures')
            .select('*')
            .eq('id', expenseId)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) {
            return res.status(404).json({ message: 'Expenditure not found.' });
        }

        const safeDate = date || existing.date;
        const safeTitle = title !== undefined ? String(title).trim() : existing.title;
        const safeNote = note !== undefined ? String(note).trim() : existing.note;
        const safePrice = price !== undefined ? Number(price) : Number(existing.price || 0);

        if (!safeDate || !safeTitle || safePrice < 0) {
            return res.status(400).json({ message: 'date, title and valid price are required.' });
        }

        const updated = {
            ...existing,
            date: safeDate,
            title: safeTitle,
            note: safeNote,
            price: safePrice,
            updatedAt: new Date().toISOString()
        };

        const { error } = await getSupabase().from('expenditures').update(updated).eq('id', expenseId);
        if (error) throw error;

        return res.json({ message: 'Expenditure updated successfully.', expenditure: updated });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Delete Expenditure
app.delete('/api/expenditures/:id', async (req, res) => {
    try {
        const expenseId = Number(req.params.id);

        const { data: existing, error: fetchError } = await getSupabase()
            .from('expenditures')
            .select('id')
            .eq('id', expenseId)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) {
            return res.status(404).json({ message: 'Expenditure not found.' });
        }

        const { error } = await getSupabase().from('expenditures').delete().eq('id', expenseId);
        if (error) throw error;

        return res.json({ message: 'Expenditure deleted successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Dynamic Chart Data
app.get('/api/dashboard/chart', async (req, res) => {
    try {
        const [framing_orders, shoot_bookings, editing_orders, expenditures] = await Promise.all([
            fetchOrdersFromTable('framing_orders'),
            fetchOrdersFromTable('shoot_bookings'),
            fetchOrdersFromTable('editing_orders'),
            fetchOrdersFromTable('expenditures')
        ]);

        const range = parseInt(req.query.range) || 180;
        const now = new Date();
        now.setHours(23, 59, 59, 999);

        const cutoffDate = new Date(now.getTime() - range * 24 * 60 * 60 * 1000);

        const labels = [];
        const monthlyRevenue = [];

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        if (range <= 30) {
            for (let i = range - 1; i >= 0; i--) {
                const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
                labels.push(`${monthNames[d.getMonth()]} ${d.getDate()}`);
                monthlyRevenue.push(0);
            }
        } else {
            const numMonths = Math.ceil(range / 30);
            for (let i = numMonths - 1; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                labels.push(monthNames[d.getMonth()]);
                monthlyRevenue.push(0);
            }
        }

        const aggregateChart = (orders) => {
            if (!orders) return;
            orders.forEach(order => {
                const orderTotal = Number(order.totalPrice || 0);
                const orderDate = new Date(order.createdAt || order.date);

                if (!isNaN(orderDate.getTime()) && orderDate >= cutoffDate) {
                    if (range <= 30) {
                        const diffTime = now.getTime() - orderDate.getTime();
                        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                        if (diffDays >= 0 && diffDays < range) {
                            const index = (range - 1) - diffDays;
                            monthlyRevenue[index] += orderTotal;
                        }
                    } else {
                        const diffMonths = (now.getFullYear() - orderDate.getFullYear()) * 12 + (now.getMonth() - orderDate.getMonth());
                        const numMonths = Math.ceil(range / 30);
                        if (diffMonths >= 0 && diffMonths < numMonths) {
                            const index = (numMonths - 1) - diffMonths;
                            monthlyRevenue[index] += orderTotal;
                        }
                    }
                }
            });
        };

        aggregateChart(framing_orders);
        aggregateChart(shoot_bookings);
        aggregateChart(editing_orders);

        const aggregateExpenses = (expenses) => {
            if (!expenses) return;
            expenses.forEach(exp => {
                const expTotal = Number(exp.price || 0);
                const expDate = new Date(exp.date || exp.createdAt);

                if (!isNaN(expDate.getTime()) && expDate >= cutoffDate) {
                    if (range <= 30) {
                        const diffTime = now.getTime() - expDate.getTime();
                        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                        if (diffDays >= 0 && diffDays < range) {
                            const index = (range - 1) - diffDays;
                            monthlyRevenue[index] -= expTotal;
                        }
                    } else {
                        const diffMonths = (now.getFullYear() - expDate.getFullYear()) * 12 + (now.getMonth() - expDate.getMonth());
                        const numMonths = Math.ceil(range / 30);
                        if (diffMonths >= 0 && diffMonths < numMonths) {
                            const index = (numMonths - 1) - diffMonths;
                            monthlyRevenue[index] -= expTotal;
                        }
                    }
                }
            });
        };
        aggregateExpenses(expenditures);

        res.json({
            labels,
            data: monthlyRevenue
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Get All Orders (Unified)
app.get('/api/orders', async (req, res) => {
    try {
        const customers = await fetchAllCustomers();
        const [framing_orders, shoot_bookings, editing_orders] = await Promise.all([
            fetchOrdersFromTable('framing_orders'),
            fetchOrdersFromTable('shoot_bookings'),
            fetchOrdersFromTable('editing_orders')
        ]);

        let allOrders = [];

        const mapOrders = (orders, type) => {
            return (orders || []).map(order => {
                const customer = customers.find(c => c.id === order.customerId);
                return {
                    ...order,
                    orderType: type,
                    customerName: (customer ? customer.name : null) || order.customerName || 'Unknown',
                    phone: (customer ? customer.phone : null) || order.phone || ''
                };
            });
        };

        allOrders = allOrders.concat(mapOrders(framing_orders, 'framing'));
        allOrders = allOrders.concat(mapOrders(shoot_bookings, 'shoot'));
        allOrders = allOrders.concat(mapOrders(editing_orders, 'editing'));

        allOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(allOrders);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Add Framing Order
app.post('/api/framing', async (req, res) => {
    try {
        const { customerName, phone, description, colorLabel, deliveryDate, price, advance, notes, additionalServices } = req.body;
        const balance = Number(price) - Number(advance);
        const calculatedStatus = balance <= 0 ? 'Completed' : 'Pending';

        let customer = await findCustomerByPhone(phone);
        if (!customer) {
            customer = await createCustomer(customerName, phone);
        }

        const safeAdditionalServices = normalizeAdditionalServicesFramingShoot(additionalServices);

        const newOrder = {
            id: await nextId(),
            customerId: customer.id,
            description,
            colorLabel,
            deliveryDate,
            additionalServices: safeAdditionalServices,
            totalPrice: price,
            advancePaid: advance,
            balance,
            notes,
            status: calculatedStatus,
            createdAt: new Date().toISOString()
        };

        const { error } = await getSupabase().from('framing_orders').insert(newOrder);
        if (error) throw error;

        res.status(201).json({ message: 'Framing order added successfully!', orderId: newOrder.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Add Photo Shoot
app.post('/api/shoots', async (req, res) => {
    try {
        const { customerName, phone, eventType, date, time, location, packageType, photographer, price, advance, colorLabel, note1, note2, additionalServices } = req.body;
        const balance = Number(price) - Number(advance);
        const calculatedStatus = balance <= 0 ? 'Completed' : 'Booked';

        let customer = await findCustomerByPhone(phone);
        if (!customer) {
            customer = await createCustomer(customerName, phone);
        }

        const safeAdditionalServices = normalizeAdditionalServicesFramingShoot(additionalServices);

        const newOrder = {
            id: await nextId(),
            customerId: customer.id,
            customerName,
            phone,
            eventType,
            date,
            time,
            location,
            packageType,
            photographer,
            colorLabel,
            additionalServices: safeAdditionalServices,
            note1,
            note2,
            totalPrice: price,
            advancePaid: advance,
            balance,
            status: calculatedStatus,
            createdAt: new Date().toISOString()
        };

        const { error } = await getSupabase().from('shoot_bookings').insert(newOrder);
        if (error) throw error;

        res.status(201).json({ message: 'Photo shoot added successfully!', orderId: newOrder.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Add Photo Editing Order
app.post('/api/editing', async (req, res) => {
    try {
        const { customerName, phone, title, deliveryDate, price, advance, additionalServices, note1, note2 } = req.body;
        const balance = Number(price) - Number(advance);
        const calculatedStatus = balance <= 0 ? 'Completed' : 'Pending';

        let customer = await findCustomerByPhone(phone);
        if (!customer) {
            customer = await createCustomer(customerName, phone);
        }

        const newOrder = {
            id: await nextId(),
            customerId: customer.id,
            customerName,
            phone,
            title,
            deliveryDate,
            additionalServices,
            totalPrice: price,
            advancePaid: advance,
            balance,
            note1,
            note2,
            status: calculatedStatus,
            createdAt: new Date().toISOString()
        };

        const { error } = await getSupabase().from('editing_orders').insert(newOrder);
        if (error) throw error;

        res.status(201).json({ message: 'Editing order added successfully!', orderId: newOrder.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Get All Notes
app.get('/api/notes', async (req, res) => {
    try {
        const { data, error } = await getSupabase().from('notes').select('*');
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Add New Note
app.post('/api/notes', async (req, res) => {
    try {
        const { title, description } = req.body;

        const newNote = {
            id: Date.now(),
            title,
            description,
            date: new Date().toISOString()
        };

        const { error } = await getSupabase().from('notes').insert(newNote);
        if (error) throw error;

        res.status(201).json({ message: 'Note added successfully!', note: newNote });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Update Note
app.put('/api/notes/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { title, description } = req.body;

        const { data: existing, error: fetchError } = await getSupabase()
            .from('notes')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ message: 'Note not found' });

        const updated = {
            ...existing,
            title,
            description,
            updatedAt: new Date().toISOString()
        };

        const { error } = await getSupabase().from('notes').update(updated).eq('id', id);
        if (error) throw error;

        res.json({ message: 'Note updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Delete Note
app.delete('/api/notes/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);

        const { data: existing, error: fetchError } = await getSupabase()
            .from('notes')
            .select('id')
            .eq('id', id)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ message: 'Note not found' });

        const { error } = await getSupabase().from('notes').delete().eq('id', id);
        if (error) throw error;

        res.json({ message: 'Note deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Get All Standalone Bookings
app.get('/api/bookings', async (req, res) => {
    try {
        const { data, error } = await getSupabase().from('bookings').select('*');
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Get Upcoming Bookings
app.get('/api/bookings/upcoming', async (req, res) => {
    try {
        const { data, error } = await getSupabase().from('bookings').select('*');
        if (error) throw error;

        const bookings = data || [];
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        const upcoming = bookings.filter(b => {
            const bDate = new Date(b.date);
            return bDate >= now;
        });

        upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));
        res.json(upcoming);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Add Standalone Booking
app.post('/api/bookings', async (req, res) => {
    try {
        const newBooking = {
            ...req.body,
            id: Date.now().toString(),
            createdAt: new Date().toISOString()
        };

        const { error } = await getSupabase().from('bookings').insert(newBooking);
        if (error) throw error;

        res.status(201).json({ message: 'Booking added successfully!', booking: newBooking });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Update Standalone Booking
app.put('/api/bookings/:id', async (req, res) => {
    try {
        const { data: existing, error: fetchError } = await getSupabase()
            .from('bookings')
            .select('*')
            .eq('id', req.params.id)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ message: 'Booking not found' });

        const updated = {
            ...existing,
            ...req.body,
            id: existing.id,
            updatedAt: new Date().toISOString()
        };

        const { error } = await getSupabase().from('bookings').update(updated).eq('id', req.params.id);
        if (error) throw error;

        res.json({ message: 'Booking updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Delete Standalone Booking
app.delete('/api/bookings/:id', async (req, res) => {
    try {
        const { data: existing, error: fetchError } = await getSupabase()
            .from('bookings')
            .select('id')
            .eq('id', req.params.id)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ message: 'Booking not found' });

        const { error } = await getSupabase().from('bookings').delete().eq('id', req.params.id);
        if (error) throw error;

        res.json({ message: 'Booking deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Generic DELETE Order
app.delete('/api/orders/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        const orderId = Number(id);
        const table = ORDER_TABLES[type];

        if (!table) return res.status(400).json({ message: 'Invalid order type' });

        const { error } = await getSupabase().from(table).delete().eq('id', orderId);
        if (error) throw error;

        res.json({ message: 'Order deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Generic PUT Order (Update)
app.put('/api/orders/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        const orderId = Number(id);
        const table = ORDER_TABLES[type];

        if (!table) return res.status(400).json({ message: 'Invalid order type' });

        const { data: existing, error: fetchError } = await getSupabase()
            .from(table)
            .select('*')
            .eq('id', orderId)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ message: 'Order not found' });

        const incomingPrice = req.body.price !== undefined ? req.body.price : req.body.totalPrice;
        const incomingAdvance = req.body.advance !== undefined ? req.body.advance : req.body.advancePaid;

        const price = Number(incomingPrice !== undefined ? incomingPrice : existing.totalPrice);
        const advance = Number(incomingAdvance !== undefined ? incomingAdvance : existing.advancePaid);
        const balance = price - advance;

        let newStatus = existing.status;
        if (balance <= 0) {
            newStatus = 'Completed';
        } else {
            newStatus = type === 'shoot' ? 'Booked' : 'Pending';
        }

        let updated = {
            ...existing,
            ...req.body,
            totalPrice: price,
            advancePaid: advance,
            balance,
            status: newStatus,
            updatedAt: new Date().toISOString()
        };

        if (req.body.customerName !== undefined) {
            updated.customerName = req.body.customerName;
        }
        if (req.body.phone !== undefined) {
            updated.phone = req.body.phone;
        }

        if (req.body.customerName !== undefined || req.body.phone !== undefined) {
            const updatedPhone = updated.phone || '';
            const updatedName = updated.customerName || 'Unknown';

            let customer = updatedPhone !== ''
                ? await findCustomerByPhoneAndName(updatedPhone, updatedName)
                : null;

            if (!customer) {
                customer = await createCustomer(updatedName, updatedPhone);
            }

            updated.customerId = customer.id;
        }

        const { error } = await getSupabase().from(table).update(updated).eq('id', orderId);
        if (error) throw error;

        res.json({ message: 'Order updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Inline Quick-Assign Color Label
app.put('/api/framing/:id', async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        const { colorLabel } = req.body;

        const { data: existing, error: fetchError } = await getSupabase()
            .from('framing_orders')
            .select('id')
            .eq('id', orderId)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ message: 'Order not found.' });

        const { error } = await getSupabase()
            .from('framing_orders')
            .update({ colorLabel, updatedAt: new Date().toISOString() })
            .eq('id', orderId);

        if (error) throw error;
        res.json({ message: 'Color label updated successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Inline Quick-Assign Color Label (Shoots)
app.put('/api/shoots/:id', async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        const { colorLabel } = req.body;

        const { data: existing, error: fetchError } = await getSupabase()
            .from('shoot_bookings')
            .select('id')
            .eq('id', orderId)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ message: 'Order not found.' });

        const { error } = await getSupabase()
            .from('shoot_bookings')
            .update({ colorLabel, updatedAt: new Date().toISOString() })
            .eq('id', orderId);

        if (error) throw error;
        res.json({ message: 'Color label updated successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Inline Quick-Assign Color Label (Editing)
app.put('/api/editing/:id', async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        const { colorLabel } = req.body;

        const { data: existing, error: fetchError } = await getSupabase()
            .from('editing_orders')
            .select('id')
            .eq('id', orderId)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ message: 'Order not found.' });

        const { error } = await getSupabase()
            .from('editing_orders')
            .update({ colorLabel, updatedAt: new Date().toISOString() })
            .eq('id', orderId);

        if (error) throw error;
        res.json({ message: 'Color label updated successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Get All Unsettled Orders
app.get('/api/unsettled-orders', async (req, res) => {
    try {
        const { data, error } = await getSupabase().from('unsettled_orders').select('*');
        if (error) throw error;

        const orders = Array.isArray(data) ? data : [];
        orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(orders);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Add Unsettled Order
app.post('/api/unsettled-orders', async (req, res) => {
    try {
        const { customerName, date, phone, title, additionalServices, advance } = req.body || {};

        const safeAdditionalServices = normalizeUnsettledServices(additionalServices);
        const totalPrice = safeAdditionalServices.reduce((sum, s) => sum + s.price, 0);
        const advancePaid = Number(advance) || 0;
        const balance = totalPrice - advancePaid;

        const newOrder = {
            id: await nextUnsettledOrderId(),
            customerName: String(customerName || '').trim(),
            date,
            phone: String(phone || '').trim(),
            title: String(title || '').trim(),
            additionalServices: safeAdditionalServices,
            totalPrice,
            advancePaid,
            balance,
            createdAt: new Date().toISOString()
        };

        const { error } = await getSupabase().from('unsettled_orders').insert(newOrder);
        if (error) throw error;

        res.status(201).json({
            message: 'Unsettled order saved successfully!',
            order: newOrder
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Update Unsettled Order
app.put('/api/unsettled-orders/:id', async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        const { customerName, date, phone, title, additionalServices, advance } = req.body || {};

        const { data: existing, error: fetchError } = await getSupabase()
            .from('unsettled_orders')
            .select('*')
            .eq('id', orderId)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        const safeAdditionalServices = normalizeUnsettledServices(additionalServices);
        const totalPrice = safeAdditionalServices.reduce((sum, s) => sum + s.price, 0);
        const advancePaid = Number(advance) || 0;
        const balance = totalPrice - advancePaid;

        const updated = {
            ...existing,
            customerName: customerName !== undefined ? String(customerName).trim() : existing.customerName,
            date: date !== undefined ? date : existing.date,
            phone: phone !== undefined ? String(phone).trim() : existing.phone,
            title: title !== undefined ? String(title).trim() : existing.title,
            additionalServices: safeAdditionalServices,
            totalPrice,
            advancePaid,
            balance,
            updatedAt: new Date().toISOString()
        };

        const { error } = await getSupabase().from('unsettled_orders').update(updated).eq('id', orderId);
        if (error) throw error;

        return res.json({ message: 'Unsettled order updated successfully.', order: updated });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// API: Delete Unsettled Order
app.delete('/api/unsettled-orders/:id', async (req, res) => {
    try {
        const orderId = Number(req.params.id);

        const { data: existing, error: fetchError } = await getSupabase()
            .from('unsettled_orders')
            .select('id')
            .eq('id', orderId)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        const { error } = await getSupabase().from('unsettled_orders').delete().eq('id', orderId);
        if (error) throw error;

        return res.json({ message: 'Unsettled order deleted successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = app;
