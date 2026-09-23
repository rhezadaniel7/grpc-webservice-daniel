require('dotenv').config();
const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { Pool } = require('pg');

// Muat definisi service langsung dari file .proto saat runtime (tanpa protoc)
const packageDef = protoLoader.loadSync(path.join(__dirname, 'produk.proto'), {
    keepCase: true,   // jaga nama field tetap snake_case (kategori_id), cocok kolom Neon
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef);

// Petakan satu baris DB -> pesan Produk (pastikan tipe & tidak ada null)
function toProduk(row) {
    return {
        id: row.id,
        nama: row.nama,
        harga: row.harga,
        stok: row.stok,
        kategori_id: row.kategori_id ?? 0,
    };
}

// Handler method gRPC. Menerima pool agar mudah diuji.
function buildHandlers(pool) {
    return {
        GetProduk: async (call, callback) => {
            try {
                const { rows } = await pool.query(
                    'SELECT id, nama, harga, stok, kategori_id FROM produk WHERE id = $1',
                    [call.request.id]
                );
                if (rows.length === 0) {
                    return callback({ code: grpc.status.NOT_FOUND, message: 'Produk tidak ditemukan' });
                }
                callback(null, toProduk(rows[0]));
            } catch (err) {
                callback({ code: grpc.status.INTERNAL, message: err.message });
            }
        },
        ListProduk: async (_call, callback) => {
            try {
                const { rows } = await pool.query(
                    'SELECT id, nama, harga, stok, kategori_id FROM produk ORDER BY id'
                );
                callback(null, { produk: rows.map(toProduk) });
            } catch (err) {
                callback({ code: grpc.status.INTERNAL, message: err.message });
            }
        },
    };
}

function createServer(pool) {
    const server = new grpc.Server();
    // PENTING: karena .proto memakai `package produk;`, service diakses
    // sebagai proto.produk.ProdukService (bukan proto.ProdukService).
    server.addService(proto.produk.ProdukService.service, buildHandlers(pool));
    return server;
}

module.exports = { createServer, proto };

// Jalankan server hanya bila file ini dieksekusi langsung (node server.js)
if (require.main === module) {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });
    const server = createServer(pool);
    const port = process.env.PORT || 50051; // Render menyediakan PORT; lokal 50051
    server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
        if (err) { console.error('Gagal bind:', err); process.exit(1); }
        console.log(`gRPC server berjalan di port ${boundPort}`);
    });
}