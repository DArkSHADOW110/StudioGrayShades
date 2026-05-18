require('dotenv').config();

const http = require('http');
const app = require('./server');

const port = Number(process.env.PORT) || 3000;
const supabaseUrl = process.env.SUPABASE_URL || '';

if (!supabaseUrl || !process.env.SUPABASE_ANON_KEY) {
    console.error('\n[ERROR] Missing SUPABASE_URL or SUPABASE_ANON_KEY.');
    console.error('Copy Backend/.env.example to Backend/.env and add your Supabase credentials.\n');
    process.exit(1);
}

if (/your_project|YOUR_PROJECT/i.test(supabaseUrl)) {
    console.error('\n[ERROR] SUPABASE_URL still contains a placeholder.');
    console.error('Edit Backend/.env with your real URL from Supabase Dashboard → Settings → API.\n');
    process.exit(1);
}

http.createServer(app).listen(port, () => {
    console.log(`Studio GrayShades API running at http://localhost:${port}`);
    console.log(`Login:  http://localhost:${port}/login.html`);
    console.log(`App:    http://localhost:${port}/index.html`);
});
