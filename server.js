// ============================================================
//  DEEMONA — Complete REST API  (server.js)
//  13 tables | JWT Auth | Rate Limiting | Input Validation
//  Node 18+ | Express 4 | SQL Server via mssql
//  Start:  node server.js
//  Docs:   http://localhost:3000/api-docs
// ============================================================
'use strict';
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');
const jwt       = require('jsonwebtoken');
const bcrypt    = require('bcryptjs');
const sql       = require('mssql');
const path      = require('path');
const { body, param, query, validationResult } = require('express-validator');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT  = process.env.JWT_SECRET || 'deemona-change-in-production';

// ─────────────────────────────────────────────────────────────
//  DB CONFIG
// ─────────────────────────────────────────────────────────────
const dbConf = {
  server:   process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME   || 'DeemonaDB',
  user:     process.env.DB_USER   || 'sa',
  password: process.env.DB_PASS   || 'YourPassword123!',
  port:     parseInt(process.env.DB_PORT || '1433'),
  options:  { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: true },
  pool:     { max: 20, min: 2, idleTimeoutMillis: 30000 },
};
let pool;
const db = async () => {
  if (!pool) { pool = await sql.connect(dbConf); console.log('✅  SQL Server connected'); }
  return pool;
};

// ─────────────────────────────────────────────────────────────
//  MIDDLEWARE
// ─────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter  = rateLimit({ windowMs: 15*60*1000, max: 300, message: { error: 'Rate limit exceeded' } });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 25,  message: { error: 'Too many auth attempts' } });
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────
const ok    = (res, data, status=200) => res.status(status).json({ success:true, data });
const fail  = (res, msg,  status=400) => res.status(status).json({ success:false, error:msg });
const wrap  = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const intId = v => parseInt(v, 10);
const validate = (req,res,next) => {
  const e = validationResult(req);
  if (!e.isEmpty()) return fail(res, e.array().map(x=>x.msg).join('; '), 422);
  next();
};
const paginate = q => {
  const page  = Math.max(1, intId(q.page||1));
  const limit = Math.min(100, Math.max(1, intId(q.limit||20)));
  return { page, limit, offset:(page-1)*limit };
};

// ─────────────────────────────────────────────────────────────
//  AUTH HELPERS
// ─────────────────────────────────────────────────────────────
function auth(req,res,next){
  const h = req.headers['authorization'];
  if (!h?.startsWith('Bearer ')) return fail(res,'Bearer token required',401);
  try { req.user = jwt.verify(h.slice(7), JWT); next(); }
  catch { fail(res,'Invalid or expired token',401); }
}
function adminOnly(req,res,next){
  if (req.user?.role !== 'admin') return fail(res,'Admin access required',403);
  next();
}

// ─────────────────────────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────────────────────────
app.get('/api/ping', (req,res) =>
  res.json({ status:'ok', timestamp:new Date().toISOString(), version:'1.0.0' }));

// ==============================================================
//  ①  AUTH  /api/auth
// ==============================================================

app.post('/api/auth/register',
  [body('firstName').notEmpty().trim(),
   body('lastName').notEmpty().trim(),
   body('email').isEmail().normalizeEmail(),
   body('password').isLength({min:8}).withMessage('Password min 8 chars'),
   body('phone').optional().isMobilePhone()], validate,
  wrap(async (req,res) => {
    const { firstName, lastName, email, phone, password } = req.body;
    const d = await db();
    const ex = await d.request().input('E',sql.NVarChar,email)
      .query('SELECT 1 FROM Customers WHERE Email=@E');
    if (ex.recordset.length) return fail(res,'Email already registered',409);
    const hash = await bcrypt.hash(password, 12);
    const r = await d.request()
      .input('F',sql.NVarChar,firstName).input('L',sql.NVarChar,lastName)
      .input('E',sql.NVarChar,email).input('P',sql.NVarChar,phone||null)
      .input('H',sql.NVarChar,hash)
      .query(`INSERT INTO Customers(FirstName,LastName,Email,PhoneNumber,PasswordHash)
              OUTPUT INSERTED.CustomerID,INSERTED.FirstName,INSERTED.LastName,
                     INSERTED.Email,INSERTED.LoyaltyPoints
              VALUES(@F,@L,@E,@P,@H)`);
    const customer = r.recordset[0];
    const token = jwt.sign({id:customer.CustomerID,email,role:'customer'}, JWT, {expiresIn:'7d'});
    ok(res, { token, customer }, 201);
  })
);

app.post('/api/auth/login',
  [body('email').isEmail(), body('password').notEmpty()], validate,
  wrap(async (req,res) => {
    const { email, password } = req.body;
    const d = await db();
    const r = await d.request().input('E',sql.NVarChar,email)
      .query('SELECT CustomerID,FirstName,LastName,Email,PasswordHash,LoyaltyPoints,AccountStatus FROM Customers WHERE Email=@E');
    if (!r.recordset.length) return fail(res,'Invalid credentials',401);
    const c = r.recordset[0];
    if (c.AccountStatus !== 'active') return fail(res,'Account suspended',403);
    if (!await bcrypt.compare(password, c.PasswordHash)) return fail(res,'Invalid credentials',401);
    await d.request().input('I',sql.Int,c.CustomerID)
      .query('UPDATE Customers SET LastLogin=GETDATE() WHERE CustomerID=@I');
    const token = jwt.sign({id:c.CustomerID,email,role:'customer'}, JWT, {expiresIn:'7d'});
    const { PasswordHash, ...safe } = c;
    ok(res, { token, customer:safe });
  })
);

app.get('/api/auth/me', auth, wrap(async (req,res) => {
  const d = await db();
  const r = await d.request().input('I',sql.Int,req.user.id)
    .query('SELECT CustomerID,FirstName,LastName,Email,PhoneNumber,City,State,PostalCode,LoyaltyPoints,RegistrationDate,AccountStatus FROM Customers WHERE CustomerID=@I');
  if (!r.recordset.length) return fail(res,'User not found',404);
  ok(res, r.recordset[0]);
}));

app.put('/api/auth/profile', auth,
  [body('firstName').optional().notEmpty(),
   body('email').optional().isEmail()], validate,
  wrap(async (req,res) => {
    const { firstName, lastName, phone, city, state, postalCode } = req.body;
    const d = await db();
    await d.request().input('I',sql.Int,req.user.id)
      .input('F',sql.NVarChar,firstName||null).input('L',sql.NVarChar,lastName||null)
      .input('P',sql.NVarChar,phone||null).input('C',sql.NVarChar,city||null)
      .input('S',sql.NVarChar,state||null).input('Z',sql.NVarChar,postalCode||null)
      .query(`UPDATE Customers SET FirstName=ISNULL(@F,FirstName),LastName=ISNULL(@L,LastName),
              PhoneNumber=ISNULL(@P,PhoneNumber),City=ISNULL(@C,City),
              State=ISNULL(@S,State),PostalCode=ISNULL(@Z,PostalCode),UpdatedAt=GETDATE()
              WHERE CustomerID=@I`);
    ok(res, { message:'Profile updated' });
  })
);

app.put('/api/auth/change-password', auth,
  [body('currentPassword').notEmpty(), body('newPassword').isLength({min:8})], validate,
  wrap(async (req,res) => {
    const { currentPassword, newPassword } = req.body;
    const d = await db();
    const r = await d.request().input('I',sql.Int,req.user.id)
      .query('SELECT PasswordHash FROM Customers WHERE CustomerID=@I');
    if (!await bcrypt.compare(currentPassword, r.recordset[0].PasswordHash))
      return fail(res,'Current password incorrect',401);
    const hash = await bcrypt.hash(newPassword, 12);
    await d.request().input('H',sql.NVarChar,hash).input('I',sql.Int,req.user.id)
      .query('UPDATE Customers SET PasswordHash=@H WHERE CustomerID=@I');
    ok(res, { message:'Password changed' });
  })
);

// ==============================================================
//  ②  CUSTOMERS  /api/customers
// ==============================================================

app.get('/api/customers', auth, adminOnly, wrap(async (req,res) => {
  const { page, limit, offset } = paginate(req.query);
  const { search, status } = req.query;
  const d = await db(); const r2 = d.request();
  const where = ['1=1'];
  if (search) { r2.input('Q',sql.NVarChar,`%${search}%`); where.push('(FirstName LIKE @Q OR LastName LIKE @Q OR Email LIKE @Q)'); }
  if (status) { r2.input('St',sql.NVarChar,status); where.push('AccountStatus=@St'); }
  r2.input('Lim',sql.Int,limit).input('Off',sql.Int,offset);
  const r = await r2.query(`
    SELECT CustomerID,FirstName,LastName,Email,PhoneNumber,City,LoyaltyPoints,AccountStatus,RegistrationDate,
           COUNT(*) OVER() AS Total
    FROM Customers WHERE ${where.join(' AND ')}
    ORDER BY CustomerID DESC OFFSET @Off ROWS FETCH NEXT @Lim ROWS ONLY`);
  const total = r.recordset[0]?.Total || 0;
  ok(res, { customers:r.recordset.map(({Total,...c})=>c), pagination:{total,page,limit,pages:Math.ceil(total/limit)} });
}));

app.get('/api/customers/:id', auth,
  [param('id').isInt()], validate,
  wrap(async (req,res) => {
    if (req.user.role!=='admin' && req.user.id!==intId(req.params.id)) return fail(res,'Forbidden',403);
    const d = await db();
    const r = await d.request().input('I',sql.Int,intId(req.params.id))
      .query(`SELECT c.CustomerID,c.FirstName,c.LastName,c.Email,c.PhoneNumber,c.Address,c.City,c.State,
                     c.PostalCode,c.Country,c.LoyaltyPoints,c.RegistrationDate,c.LastLogin,c.AccountStatus,
                     COUNT(DISTINCT o.OrderID) AS TotalOrders,
                     ISNULL(SUM(o.TotalAmount),0) AS LifetimeValue
              FROM Customers c
              LEFT JOIN Orders o ON o.CustomerID=c.CustomerID AND o.Status NOT IN('cancelled','refunded')
              WHERE c.CustomerID=@I
              GROUP BY c.CustomerID,c.FirstName,c.LastName,c.Email,c.PhoneNumber,c.Address,c.City,
                       c.State,c.PostalCode,c.Country,c.LoyaltyPoints,c.RegistrationDate,c.LastLogin,c.AccountStatus`);
    if (!r.recordset.length) return fail(res,'Customer not found',404);
    ok(res, r.recordset[0]);
  })
);

app.patch('/api/customers/:id/status', auth, adminOnly,
  [param('id').isInt(), body('status').isIn(['active','inactive','suspended','deleted'])], validate,
  wrap(async (req,res) => {
    const d = await db();
    await d.request().input('I',sql.Int,intId(req.params.id)).input('S',sql.NVarChar,req.body.status)
      .query('UPDATE Customers SET AccountStatus=@S WHERE CustomerID=@I');
    ok(res, { message:`Status updated to ${req.body.status}` });
  })
);

app.delete('/api/customers/:id', auth, adminOnly,
  [param('id').isInt()], validate,
  wrap(async (req,res) => {
    const d = await db();
    await d.request().input('I',sql.Int,intId(req.params.id))
      .query("UPDATE Customers SET AccountStatus='deleted' WHERE CustomerID=@I");
    ok(res, { message:'Customer deactivated' });
  })
);

// ==============================================================
//  ③  CATEGORIES  /api/categories
// ==============================================================

app.get('/api/categories', wrap(async (req,res) => {
  const d = await db();
  const r = await d.request().query(`
    SELECT c.CategoryID,c.CategoryName,c.Description,c.ParentCategoryID,c.IsActive,
           COUNT(p.ProductID) AS ProductCount
    FROM Categories c LEFT JOIN Products p ON p.CategoryID=c.CategoryID AND p.IsActive=1
    WHERE c.IsActive=1 GROUP BY c.CategoryID,c.CategoryName,c.Description,c.ParentCategoryID,c.IsActive
    ORDER BY c.CategoryName`);
  ok(res, r.recordset);
}));

app.get('/api/categories/:id', [param('id').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  const r = await d.request().input('I',sql.Int,intId(req.params.id))
    .query('SELECT * FROM Categories WHERE CategoryID=@I');
  if (!r.recordset.length) return fail(res,'Category not found',404);
  ok(res, r.recordset[0]);
}));

app.post('/api/categories', auth, adminOnly,
  [body('categoryName').notEmpty().trim()], validate,
  wrap(async (req,res) => {
    const { categoryName, description, parentCategoryID } = req.body;
    const d = await db();
    const r = await d.request()
      .input('N',sql.NVarChar,categoryName).input('D',sql.NVarChar,description||null)
      .input('P',sql.Int,parentCategoryID||null)
      .query('INSERT INTO Categories(CategoryName,Description,ParentCategoryID) OUTPUT INSERTED.CategoryID VALUES(@N,@D,@P)');
    ok(res, { categoryID:r.recordset[0].CategoryID, message:'Category created' }, 201);
  })
);

app.put('/api/categories/:id', auth, adminOnly, [param('id').isInt()], validate, wrap(async (req,res) => {
  const { categoryName, description, isActive } = req.body;
  const d = await db();
  await d.request().input('I',sql.Int,intId(req.params.id))
    .input('N',sql.NVarChar,categoryName||null).input('D',sql.NVarChar,description||null)
    .input('A',sql.Bit,isActive!=null?isActive:null)
    .query('UPDATE Categories SET CategoryName=ISNULL(@N,CategoryName),Description=ISNULL(@D,Description),IsActive=ISNULL(@A,IsActive) WHERE CategoryID=@I');
  ok(res, { message:'Category updated' });
}));

app.delete('/api/categories/:id', auth, adminOnly, [param('id').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  await d.request().input('I',sql.Int,intId(req.params.id))
    .query('UPDATE Categories SET IsActive=0 WHERE CategoryID=@I');
  ok(res, { message:'Category deactivated' });
}));

// ==============================================================
//  ④  PRODUCTS  /api/products
// ==============================================================

app.get('/api/products', wrap(async (req,res) => {
  const { page, limit, offset } = paginate(req.query);
  const { category, search, minPrice, maxPrice, minRating, sort, featured, brand } = req.query;
  const d = await db(); const r2 = d.request();
  const where = ['p.IsActive=1'];
  if (category)  { r2.input('Cat',sql.NVarChar,category);        where.push('c.CategoryName=@Cat'); }
  if (search)    { r2.input('Q',  sql.NVarChar,`%${search}%`);   where.push('(p.Name LIKE @Q OR p.Description LIKE @Q OR p.Brand LIKE @Q OR p.Tags LIKE @Q)'); }
  if (brand)     { r2.input('B',  sql.NVarChar,`%${brand}%`);    where.push('p.Brand LIKE @B'); }
  if (minPrice)  { r2.input('MinP',sql.Decimal,parseFloat(minPrice)); where.push('p.Price>=@MinP'); }
  if (maxPrice)  { r2.input('MaxP',sql.Decimal,parseFloat(maxPrice)); where.push('p.Price<=@MaxP'); }
  if (minRating) { r2.input('MinR',sql.Decimal,parseFloat(minRating)); where.push('p.AverageRating>=@MinR'); }
  if (featured==='true') where.push('p.IsFeatured=1');
  const sortMap = { price_asc:'p.Price ASC', price_desc:'p.Price DESC', rating:'p.AverageRating DESC', newest:'p.CreatedAt DESC', bestseller:'p.ReviewsCount DESC' };
  r2.input('Lim',sql.Int,limit).input('Off',sql.Int,offset);
  const r = await r2.query(`
    SELECT p.ProductID,p.Name,p.SKU,p.Brand,p.Price,p.MRP,p.StockQuantity,
           p.AverageRating,p.ReviewsCount,p.IsFeatured,p.Tags,p.ImageURLs,
           c.CategoryName,s.SupplierName,
           CASE WHEN p.MRP>0 THEN ROUND((p.MRP-p.Price)*100.0/p.MRP,0) ELSE 0 END AS DiscountPct,
           CASE WHEN p.StockQuantity=0 THEN 'out_of_stock'
                WHEN p.StockQuantity<=10 THEN 'low_stock' ELSE 'in_stock' END AS StockStatus,
           COUNT(*) OVER() AS Total
    FROM Products p
    LEFT JOIN Categories c ON c.CategoryID=p.CategoryID
    LEFT JOIN Suppliers  s ON s.SupplierID=p.SupplierID
    WHERE ${where.join(' AND ')}
    ORDER BY ${sortMap[sort]||'p.IsFeatured DESC,p.ViewsCount DESC'}
    OFFSET @Off ROWS FETCH NEXT @Lim ROWS ONLY`);
  const total = r.recordset[0]?.Total || 0;
  ok(res, { products:r.recordset.map(({Total,...p})=>p), pagination:{total,page,limit,pages:Math.ceil(total/limit)} });
}));

app.get('/api/products/:id', [param('id').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  const r = await d.request().input('I',sql.Int,intId(req.params.id))
    .query(`SELECT p.*,c.CategoryName,s.SupplierName,
      CASE WHEN p.MRP>0 THEN ROUND((p.MRP-p.Price)*100.0/p.MRP,0) ELSE 0 END AS DiscountPct,
      CASE WHEN p.StockQuantity=0 THEN 'out_of_stock' WHEN p.StockQuantity<=10 THEN 'low_stock' ELSE 'in_stock' END AS StockStatus
      FROM Products p LEFT JOIN Categories c ON c.CategoryID=p.CategoryID LEFT JOIN Suppliers s ON s.SupplierID=p.SupplierID
      WHERE p.ProductID=@I AND p.IsActive=1`);
  if (!r.recordset.length) return fail(res,'Product not found',404);
  await d.request().input('I',sql.Int,intId(req.params.id))
    .query('UPDATE Products SET ViewsCount=ViewsCount+1 WHERE ProductID=@I');
  ok(res, r.recordset[0]);
}));

app.post('/api/products', auth, adminOnly,
  [body('name').notEmpty(), body('sku').notEmpty(), body('price').isFloat({min:0})], validate,
  wrap(async (req,res) => {
    const { name, description, sku, brand, categoryID, supplierID, price, mrp, costPrice, stockQuantity, reorderLevel, tags, isFeatured, imageURLs } = req.body;
    const d = await db();
    const r = await d.request()
      .input('N',sql.NVarChar,name).input('D',sql.NVarChar,description||null).input('S',sql.NVarChar,sku)
      .input('B',sql.NVarChar,brand||null).input('C',sql.Int,categoryID||null).input('Sup',sql.Int,supplierID||null)
      .input('P',sql.Decimal,parseFloat(price)).input('M',sql.Decimal,parseFloat(mrp||price))
      .input('CP',sql.Decimal,costPrice?parseFloat(costPrice):null).input('St',sql.Int,parseInt(stockQuantity||0))
      .input('RL',sql.Int,parseInt(reorderLevel||10)).input('T',sql.NVarChar,tags||null)
      .input('F',sql.Bit,isFeatured?1:0).input('Img',sql.NVarChar,imageURLs||null)
      .query(`INSERT INTO Products(Name,Description,SKU,Brand,CategoryID,SupplierID,Price,MRP,CostPrice,StockQuantity,ReorderLevel,Tags,IsFeatured,ImageURLs)
              OUTPUT INSERTED.ProductID VALUES(@N,@D,@S,@B,@C,@Sup,@P,@M,@CP,@St,@RL,@T,@F,@Img)`);
    ok(res, { productID:r.recordset[0].ProductID, message:'Product created' }, 201);
  })
);

app.put('/api/products/:id', auth, adminOnly, [param('id').isInt()], validate, wrap(async (req,res) => {
  const { name, description, price, mrp, stockQuantity, isActive, isFeatured, tags, brand, categoryID } = req.body;
  const d = await db();
  await d.request().input('I',sql.Int,intId(req.params.id))
    .input('N',sql.NVarChar,name||null).input('D',sql.NVarChar,description||null)
    .input('P',sql.Decimal,price?parseFloat(price):null).input('M',sql.Decimal,mrp?parseFloat(mrp):null)
    .input('St',sql.Int,stockQuantity!=null?parseInt(stockQuantity):null)
    .input('A',sql.Bit,isActive!=null?isActive:null).input('F',sql.Bit,isFeatured!=null?isFeatured:null)
    .input('T',sql.NVarChar,tags||null).input('B',sql.NVarChar,brand||null).input('C',sql.Int,categoryID||null)
    .query(`UPDATE Products SET Name=ISNULL(@N,Name),Description=ISNULL(@D,Description),Price=ISNULL(@P,Price),
      MRP=ISNULL(@M,MRP),StockQuantity=ISNULL(@St,StockQuantity),IsActive=ISNULL(@A,IsActive),
      IsFeatured=ISNULL(@F,IsFeatured),Tags=ISNULL(@T,Tags),Brand=ISNULL(@B,Brand),
      CategoryID=ISNULL(@C,CategoryID),UpdatedAt=GETDATE() WHERE ProductID=@I`);
  ok(res, { message:'Product updated' });
}));

app.delete('/api/products/:id', auth, adminOnly, [param('id').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  await d.request().input('I',sql.Int,intId(req.params.id))
    .query('UPDATE Products SET IsActive=0 WHERE ProductID=@I');
  ok(res, { message:'Product deactivated' });
}));

// ==============================================================
//  ⑤  INVENTORY  /api/inventory
// ==============================================================

app.get('/api/inventory', auth, adminOnly, wrap(async (req,res) => {
  const { page, limit, offset } = paginate(req.query);
  const { lowStock } = req.query;
  const d = await db(); const r2 = d.request();
  let q = `SELECT i.*,p.Name AS ProductName,p.SKU,p.StockQuantity,p.ReorderLevel,c.CategoryName,
    CASE WHEN p.StockQuantity=0 THEN 'CRITICAL' WHEN p.StockQuantity<=5 THEN 'URGENT'
         WHEN p.StockQuantity<=p.ReorderLevel THEN 'LOW' ELSE 'OK' END AS AlertLevel,
    COUNT(*) OVER() AS Total
    FROM Inventory i INNER JOIN Products p ON p.ProductID=i.ProductID
    LEFT JOIN Categories c ON c.CategoryID=p.CategoryID WHERE 1=1`;
  if (lowStock==='true') q += ' AND p.StockQuantity<=p.ReorderLevel';
  q += ' ORDER BY p.StockQuantity ASC OFFSET @Off ROWS FETCH NEXT @Lim ROWS ONLY';
  r2.input('Lim',sql.Int,limit).input('Off',sql.Int,offset);
  const r = await r2.query(q);
  const total = r.recordset[0]?.Total || 0;
  ok(res, { inventory:r.recordset.map(({Total,...i})=>i), pagination:{total,page,limit,pages:Math.ceil(total/limit)} });
}));

app.get('/api/inventory/:id', auth, [param('id').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  const r = await d.request().input('I',sql.Int,intId(req.params.id))
    .query('SELECT i.*,p.Name AS ProductName,p.SKU FROM Inventory i INNER JOIN Products p ON p.ProductID=i.ProductID WHERE i.InventoryID=@I');
  if (!r.recordset.length) return fail(res,'Inventory record not found',404);
  ok(res, r.recordset[0]);
}));

app.post('/api/inventory', auth, adminOnly,
  [body('productID').isInt(), body('location').notEmpty(), body('stockLevel').isInt({min:0})], validate,
  wrap(async (req,res) => {
    const { productID, location, stockLevel } = req.body;
    const d = await db();
    const r = await d.request().input('P',sql.Int,productID).input('L',sql.NVarChar,location).input('S',sql.Int,stockLevel)
      .query('INSERT INTO Inventory(ProductID,Location,StockLevel,LastUpdated) OUTPUT INSERTED.InventoryID VALUES(@P,@L,@S,GETDATE())');
    ok(res, { inventoryID:r.recordset[0].InventoryID, message:'Inventory record created' }, 201);
  })
);

app.put('/api/inventory/:id', auth, adminOnly, [param('id').isInt()], validate, wrap(async (req,res) => {
  const { location, stockLevel } = req.body;
  const d = await db();
  await d.request().input('I',sql.Int,intId(req.params.id))
    .input('L',sql.NVarChar,location||null).input('S',sql.Int,stockLevel!=null?parseInt(stockLevel):null)
    .query('UPDATE Inventory SET Location=ISNULL(@L,Location),StockLevel=ISNULL(@S,StockLevel),LastUpdated=GETDATE() WHERE InventoryID=@I');
  ok(res, { message:'Inventory updated' });
}));

// ==============================================================
//  ⑥  CART  /api/cart
// ==============================================================

async function getOrCreateCart(customerID) {
  const d = await db();
  let r = await d.request().input('C',sql.Int,customerID).query('SELECT CartID FROM Carts WHERE CustomerID=@C');
  if (r.recordset.length) return r.recordset[0].CartID;
  const n = await d.request().input('C',sql.Int,customerID)
    .query('INSERT INTO Carts(CustomerID) OUTPUT INSERTED.CartID VALUES(@C)');
  return n.recordset[0].CartID;
}

app.get('/api/cart', auth, wrap(async (req,res) => {
  const d = await db();
  const r = await d.request().input('C',sql.Int,req.user.id)
    .query(`SELECT ci.CartItemID,ci.ProductID,ci.Quantity,p.Name,p.Price,p.MRP,p.StockQuantity,p.ImageURLs,
      CASE WHEN p.MRP>0 THEN ROUND((p.MRP-p.Price)*100.0/p.MRP,0) ELSE 0 END AS DiscountPct,
      p.Price*ci.Quantity AS LineTotal
      FROM CartItems ci INNER JOIN Carts c ON c.CartID=ci.CartID
      INNER JOIN Products p ON p.ProductID=ci.ProductID
      WHERE c.CustomerID=@C AND p.IsActive=1 ORDER BY ci.CartItemID DESC`);
  const sub = r.recordset.reduce((s,i)=>s+i.LineTotal,0);
  const ship = sub>=499?0:49;
  ok(res, { items:r.recordset, summary:{itemCount:r.recordset.length,subTotal:sub,shipping:ship,total:sub+ship} });
}));

app.post('/api/cart', auth,
  [body('productID').isInt(), body('quantity').isInt({min:1})], validate,
  wrap(async (req,res) => {
    const { productID, quantity } = req.body;
    const d = await db();
    const stock = await d.request().input('P',sql.Int,productID)
      .query('SELECT StockQuantity FROM Products WHERE ProductID=@P AND IsActive=1');
    if (!stock.recordset.length) return fail(res,'Product not found',404);
    if (stock.recordset[0].StockQuantity < quantity)
      return fail(res,`Only ${stock.recordset[0].StockQuantity} units available`,400);
    const cartID = await getOrCreateCart(req.user.id);
    const ex = await d.request().input('Cart',sql.Int,cartID).input('P',sql.Int,productID)
      .query('SELECT CartItemID,Quantity FROM CartItems WHERE CartID=@Cart AND ProductID=@P');
    if (ex.recordset.length) {
      const newQ = Math.min(ex.recordset[0].Quantity+quantity, stock.recordset[0].StockQuantity);
      await d.request().input('Q',sql.Int,newQ).input('I',sql.Int,ex.recordset[0].CartItemID)
        .query('UPDATE CartItems SET Quantity=@Q WHERE CartItemID=@I');
    } else {
      await d.request().input('Cart',sql.Int,cartID).input('P',sql.Int,productID).input('Q',sql.Int,quantity)
        .query('INSERT INTO CartItems(CartID,ProductID,Quantity) VALUES(@Cart,@P,@Q)');
    }
    ok(res, { message:'Cart updated' });
  })
);

app.put('/api/cart/:itemId', auth,
  [param('itemId').isInt(), body('quantity').isInt({min:1})], validate,
  wrap(async (req,res) => {
    const d = await db();
    await d.request().input('I',sql.Int,intId(req.params.itemId)).input('Q',sql.Int,req.body.quantity)
      .query('UPDATE CartItems SET Quantity=@Q WHERE CartItemID=@I');
    ok(res, { message:'Quantity updated' });
  })
);

app.delete('/api/cart/:itemId', auth, [param('itemId').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  await d.request().input('I',sql.Int,intId(req.params.itemId))
    .query('DELETE FROM CartItems WHERE CartItemID=@I');
  ok(res, { message:'Item removed' });
}));

app.delete('/api/cart', auth, wrap(async (req,res) => {
  const d = await db();
  await d.request().input('C',sql.Int,req.user.id)
    .query('DELETE ci FROM CartItems ci INNER JOIN Carts c ON c.CartID=ci.CartID WHERE c.CustomerID=@C');
  ok(res, { message:'Cart cleared' });
}));

// ==============================================================
//  ⑦  ORDERS  /api/orders
// ==============================================================

app.get('/api/orders', auth, wrap(async (req,res) => {
  const { page, limit, offset } = paginate(req.query);
  const { status } = req.query;
  const d = await db(); const r2 = d.request();
  const where = [`o.CustomerID=@CID`];
  r2.input('CID',sql.Int,req.user.id);
  if (status) { r2.input('St',sql.NVarChar,status); where.push('o.Status=@St'); }
  r2.input('Lim',sql.Int,limit).input('Off',sql.Int,offset);
  const r = await r2.query(`
    SELECT o.OrderID,o.OrderDate,o.TotalAmount,o.Status,o.PaymentMethod,
           o.ShippingAddress,o.CouponCode,o.DeliveryDateEstimate,
           COUNT(oi.OrderItemID) AS ItemCount,COUNT(*) OVER() AS Total
    FROM Orders o LEFT JOIN OrderItems oi ON oi.OrderID=o.OrderID
    WHERE ${where.join(' AND ')}
    GROUP BY o.OrderID,o.OrderDate,o.TotalAmount,o.Status,o.PaymentMethod,o.ShippingAddress,o.CouponCode,o.DeliveryDateEstimate
    ORDER BY o.OrderDate DESC OFFSET @Off ROWS FETCH NEXT @Lim ROWS ONLY`);
  const total = r.recordset[0]?.Total || 0;
  ok(res, { orders:r.recordset.map(({Total,...o})=>o), pagination:{total,page,limit,pages:Math.ceil(total/limit)} });
}));

app.get('/api/orders/:id', auth, [param('id').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  const o = await d.request().input('O',sql.Int,intId(req.params.id)).input('C',sql.Int,req.user.id)
    .query(`SELECT o.*,c.FirstName+' '+c.LastName AS CustomerName,c.Email FROM Orders o
      INNER JOIN Customers c ON c.CustomerID=o.CustomerID
      WHERE o.OrderID=@O AND o.CustomerID=@C`);
  if (!o.recordset.length) return fail(res,'Order not found',404);
  const items = await d.request().input('O',sql.Int,intId(req.params.id))
    .query('SELECT oi.*,p.Name AS ProductName,p.ImageURLs,p.Brand FROM OrderItems oi INNER JOIN Products p ON p.ProductID=oi.ProductID WHERE oi.OrderID=@O');
  const ship = await d.request().input('O',sql.Int,intId(req.params.id)).query('SELECT * FROM Shipping WHERE OrderID=@O');
  const pay  = await d.request().input('O',sql.Int,intId(req.params.id))
    .query('SELECT PaymentID,Amount,PaymentMethod,PaymentStatus,PaymentDate,Currency FROM Payments WHERE OrderID=@O');
  ok(res, { order:o.recordset[0], items:items.recordset, shipping:ship.recordset[0]||null, payment:pay.recordset[0]||null });
}));

app.post('/api/orders', auth,
  [body('items').isArray({min:1}), body('shippingAddress').notEmpty(), body('paymentMethod').notEmpty()], validate,
  wrap(async (req,res) => {
    const { items, shippingAddress, billingAddress, paymentMethod, couponCode } = req.body;
    const d = await db();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      let subTotal = 0;
      const enriched = [];
      for (const item of items) {
        const p = await new sql.Request(tx).input('P',sql.Int,item.productID)
          .query('SELECT ProductID,Name,Price,MRP,StockQuantity FROM Products WHERE ProductID=@P AND IsActive=1');
        if (!p.recordset.length) throw new Error(`Product ${item.productID} not found`);
        if (p.recordset[0].StockQuantity < item.quantity) throw new Error(`Insufficient stock: ${p.recordset[0].Name}`);
        enriched.push({...p.recordset[0], quantity:item.quantity});
        subTotal += p.recordset[0].Price * item.quantity;
      }
      let discountAmt=0, discountID=null;
      if (couponCode) {
        const cp = await new sql.Request(tx).input('Code',sql.NVarChar,couponCode.toUpperCase())
          .query('SELECT * FROM Discounts WHERE Code=@Code AND ActiveStatus=1 AND GETDATE() BETWEEN StartDate AND EndDate AND (UsageLimit IS NULL OR UsageCount<UsageLimit)');
        if (cp.recordset.length) {
          const c = cp.recordset[0]; discountID=c.DiscountID;
          if (subTotal>=c.MinOrderValue) {
            discountAmt = c.DiscountPercentage ? Math.round(subTotal*c.DiscountPercentage/100) : (c.DiscountAmount||0);
            if (c.MaxDiscountAmount) discountAmt = Math.min(discountAmt,c.MaxDiscountAmount);
          }
        }
      }
      const taxAmt  = Math.round(subTotal*0.18);
      const shipAmt = subTotal>=499?0:49;
      const total   = subTotal+taxAmt+shipAmt-discountAmt;
      const oRes = await new sql.Request(tx)
        .input('C',sql.Int,req.user.id).input('Sub',sql.Decimal,subTotal).input('Tax',sql.Decimal,taxAmt)
        .input('Ship',sql.Decimal,shipAmt).input('Disc',sql.Decimal,discountAmt).input('Tot',sql.Decimal,total)
        .input('PM',sql.NVarChar,paymentMethod).input('SA',sql.NVarChar,JSON.stringify(shippingAddress))
        .input('BA',sql.NVarChar,JSON.stringify(billingAddress||shippingAddress))
        .input('CC',sql.NVarChar,couponCode?.toUpperCase()||null).input('DID',sql.Int,discountID)
        .input('Est',sql.Date,new Date(Date.now()+5*86400*1000))
        .query(`INSERT INTO Orders(CustomerID,SubTotal,TaxAmount,ShippingAmount,DiscountAmount,TotalAmount,PaymentMethod,ShippingAddress,BillingAddress,CouponCode,DiscountID,DeliveryDateEstimate)
          OUTPUT INSERTED.OrderID VALUES(@C,@Sub,@Tax,@Ship,@Disc,@Tot,@PM,@SA,@BA,@CC,@DID,@Est)`);
      const orderID = oRes.recordset[0].OrderID;
      for (const item of enriched) {
        await new sql.Request(tx).input('O',sql.Int,orderID).input('P',sql.Int,item.ProductID)
          .input('Q',sql.Int,item.quantity).input('UP',sql.Decimal,item.Price).input('M',sql.Decimal,item.MRP)
          .query('INSERT INTO OrderItems(OrderID,ProductID,Quantity,UnitPrice,MRP) VALUES(@O,@P,@Q,@UP,@M)');
        await new sql.Request(tx).input('P',sql.Int,item.ProductID).input('Q',sql.Int,item.quantity)
          .query('UPDATE Products SET StockQuantity=StockQuantity-@Q WHERE ProductID=@P');
      }
      await new sql.Request(tx).input('O',sql.Int,orderID).input('Est',sql.Date,new Date(Date.now()+5*86400*1000))
        .query("INSERT INTO Shipping(OrderID,ShippingStatus,EstimatedDeliveryDate) VALUES(@O,'pending',@Est)");
      await new sql.Request(tx).input('O',sql.Int,orderID).input('A',sql.Decimal,total).input('PM',sql.NVarChar,paymentMethod)
        .query("INSERT INTO Payments(OrderID,Amount,PaymentMethod,PaymentStatus) VALUES(@O,@A,@PM,'pending')");
      const pts = Math.floor(total/100);
      await new sql.Request(tx).input('P',sql.Int,pts).input('C',sql.Int,req.user.id)
        .query('UPDATE Customers SET LoyaltyPoints=LoyaltyPoints+@P WHERE CustomerID=@C');
      await new sql.Request(tx).input('C',sql.Int,req.user.id)
        .query('DELETE ci FROM CartItems ci INNER JOIN Carts c ON c.CartID=ci.CartID WHERE c.CustomerID=@C');
      if (discountID) await new sql.Request(tx).input('D',sql.Int,discountID)
        .query('UPDATE Discounts SET UsageCount=UsageCount+1 WHERE DiscountID=@D');
      await tx.commit();
      ok(res, { orderID, totalAmount:total, taxAmount:taxAmt, shippingAmount:shipAmt, discountAmount:discountAmt, loyaltyPointsEarned:pts }, 201);
    } catch(e) { await tx.rollback(); throw e; }
  })
);

app.patch('/api/orders/:id/cancel', auth, [param('id').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  const chk = await d.request().input('O',sql.Int,intId(req.params.id)).input('C',sql.Int,req.user.id)
    .query("SELECT 1 FROM Orders WHERE OrderID=@O AND CustomerID=@C AND Status IN('pending','confirmed')");
  if (!chk.recordset.length) return fail(res,'Order cannot be cancelled');
  await d.request().input('O',sql.Int,intId(req.params.id))
    .query("UPDATE Orders SET Status='cancelled',UpdatedAt=GETDATE() WHERE OrderID=@O");
  await d.request().input('O',sql.Int,intId(req.params.id))
    .query("UPDATE OrderItems SET FulfillmentStatus='cancelled' WHERE OrderID=@O");
  ok(res, { message:'Order cancelled' });
}));

app.get('/api/admin/orders', auth, adminOnly, wrap(async (req,res) => {
  const { page, limit, offset } = paginate(req.query);
  const { status } = req.query;
  const d = await db(); const r2 = d.request();
  const where = ['1=1'];
  if (status) { r2.input('St',sql.NVarChar,status); where.push('o.Status=@St'); }
  r2.input('Lim',sql.Int,limit).input('Off',sql.Int,offset);
  const r = await r2.query(`
    SELECT o.OrderID,o.OrderDate,o.TotalAmount,o.Status,o.PaymentMethod,
           c.FirstName+' '+c.LastName AS CustomerName,c.Email,
           COUNT(oi.OrderItemID) AS ItemCount,COUNT(*) OVER() AS Total
    FROM Orders o INNER JOIN Customers c ON c.CustomerID=o.CustomerID
    LEFT JOIN OrderItems oi ON oi.OrderID=o.OrderID
    WHERE ${where.join(' AND ')}
    GROUP BY o.OrderID,o.OrderDate,o.TotalAmount,o.Status,o.PaymentMethod,c.FirstName,c.LastName,c.Email
    ORDER BY o.OrderDate DESC OFFSET @Off ROWS FETCH NEXT @Lim ROWS ONLY`);
  const total = r.recordset[0]?.Total || 0;
  ok(res, { orders:r.recordset.map(({Total,...o})=>o), pagination:{total,page,limit,pages:Math.ceil(total/limit)} });
}));

app.patch('/api/admin/orders/:id/status', auth, adminOnly,
  [param('id').isInt(), body('status').isIn(['pending','confirmed','processing','shipped','delivered','cancelled','refunded','on_hold'])], validate,
  wrap(async (req,res) => {
    const d = await db();
    await d.request().input('S',sql.NVarChar,req.body.status).input('O',sql.Int,intId(req.params.id))
      .query('UPDATE Orders SET Status=@S,UpdatedAt=GETDATE() WHERE OrderID=@O');
    ok(res, { message:`Status → ${req.body.status}` });
  })
);

// ==============================================================
//  ⑧  PAYMENTS  /api/payments
// ==============================================================

app.get('/api/payments', auth, adminOnly, wrap(async (req,res) => {
  const { page, limit, offset } = paginate(req.query);
  const { status, method } = req.query;
  const d = await db(); const r2 = d.request();
  const where = ['1=1'];
  if (status) { r2.input('St',sql.NVarChar,status); where.push('p.PaymentStatus=@St'); }
  if (method) { r2.input('M',sql.NVarChar,method);  where.push('p.PaymentMethod=@M'); }
  r2.input('Lim',sql.Int,limit).input('Off',sql.Int,offset);
  const r = await r2.query(`SELECT p.*,c.FirstName+' '+c.LastName AS CustomerName,COUNT(*) OVER() AS Total
    FROM Payments p INNER JOIN Orders o ON o.OrderID=p.OrderID INNER JOIN Customers c ON c.CustomerID=o.CustomerID
    WHERE ${where.join(' AND ')} ORDER BY p.CreatedAt DESC OFFSET @Off ROWS FETCH NEXT @Lim ROWS ONLY`);
  const total = r.recordset[0]?.Total || 0;
  ok(res, { payments:r.recordset.map(({Total,...p})=>p), pagination:{total,page,limit,pages:Math.ceil(total/limit)} });
}));

app.get('/api/payments/:id', auth, [param('id').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  const r = await d.request().input('I',sql.Int,intId(req.params.id))
    .query('SELECT p.*,o.Status AS OrderStatus FROM Payments p INNER JOIN Orders o ON o.OrderID=p.OrderID WHERE p.PaymentID=@I');
  if (!r.recordset.length) return fail(res,'Payment not found',404);
  ok(res, r.recordset[0]);
}));

app.patch('/api/payments/:id/status', auth, adminOnly,
  [param('id').isInt(), body('status').isIn(['pending','initiated','completed','failed','refunded','partially_refunded','cancelled'])], validate,
  wrap(async (req,res) => {
    const { status, transactionReference } = req.body;
    const d = await db();
    await d.request().input('I',sql.Int,intId(req.params.id)).input('S',sql.NVarChar,status)
      .input('TR',sql.NVarChar,transactionReference||null)
      .input('PD',sql.DateTime2,status==='completed'?new Date():null)
      .query(`UPDATE Payments SET PaymentStatus=@S,TransactionReference=ISNULL(@TR,TransactionReference),
        PaymentDate=ISNULL(@PD,PaymentDate),UpdatedAt=GETDATE() WHERE PaymentID=@I`);
    ok(res, { message:`Payment → ${status}` });
  })
);

// ==============================================================
//  ⑨  SHIPPING  /api/shipping
// ==============================================================

app.get('/api/shipping', auth, adminOnly, wrap(async (req,res) => {
  const { page, limit, offset } = paginate(req.query);
  const { status } = req.query;
  const d = await db(); const r2 = d.request();
  const where = ['1=1'];
  if (status) { r2.input('St',sql.NVarChar,status); where.push('s.ShippingStatus=@St'); }
  r2.input('Lim',sql.Int,limit).input('Off',sql.Int,offset);
  const r = await r2.query(`SELECT s.*,c.FirstName+' '+c.LastName AS CustomerName,o.TotalAmount,COUNT(*) OVER() AS Total
    FROM Shipping s INNER JOIN Orders o ON o.OrderID=s.OrderID INNER JOIN Customers c ON c.CustomerID=o.CustomerID
    WHERE ${where.join(' AND ')} ORDER BY s.CreatedAt DESC OFFSET @Off ROWS FETCH NEXT @Lim ROWS ONLY`);
  const total = r.recordset[0]?.Total || 0;
  ok(res, { shipments:r.recordset.map(({Total,...s})=>s), pagination:{total,page,limit,pages:Math.ceil(total/limit)} });
}));

app.get('/api/shipping/track/:orderId', auth, [param('orderId').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  const r = await d.request().input('O',sql.Int,intId(req.params.orderId)).input('C',sql.Int,req.user.id)
    .query(`SELECT s.*,o.Status AS OrderStatus,o.OrderDate,o.DeliveryDateEstimate
      FROM Shipping s INNER JOIN Orders o ON o.OrderID=s.OrderID
      WHERE s.OrderID=@O AND o.CustomerID=@C`);
  if (!r.recordset.length) return fail(res,'Tracking not found',404);
  ok(res, r.recordset[0]);
}));

app.patch('/api/admin/shipping/:id', auth, adminOnly, [param('id').isInt()], validate, wrap(async (req,res) => {
  const { carrier, trackingNumber, shippingStatus, actualDeliveryDate } = req.body;
  const d = await db();
  await d.request().input('I',sql.Int,intId(req.params.id))
    .input('Car',sql.NVarChar,carrier||null).input('Trk',sql.NVarChar,trackingNumber||null)
    .input('St',sql.NVarChar,shippingStatus||null).input('D',sql.Date,actualDeliveryDate?new Date(actualDeliveryDate):null)
    .query(`UPDATE Shipping SET Carrier=ISNULL(@Car,Carrier),TrackingNumber=ISNULL(@Trk,TrackingNumber),
      ShippingStatus=ISNULL(@St,ShippingStatus),ActualDeliveryDate=ISNULL(@D,ActualDeliveryDate),UpdatedAt=GETDATE()
      WHERE ShippingID=@I`);
  ok(res, { message:'Shipping updated' });
}));

// ==============================================================
//  ⑩  REVIEWS  /api/products/:id/reviews
// ==============================================================

app.get('/api/products/:id/reviews', [param('id').isInt()], validate, wrap(async (req,res) => {
  const { page, limit, offset } = paginate(req.query);
  const d = await db();
  const r = await d.request().input('P',sql.Int,intId(req.params.id))
    .input('Lim',sql.Int,limit).input('Off',sql.Int,offset)
    .query(`SELECT r.ReviewID,r.Rating,r.Title,r.Comment,r.ReviewDate,r.VerifiedPurchase,r.HelpfulVotes,r.Reply,
      c.FirstName+' '+LEFT(c.LastName,1)+'.' AS ReviewerName,COUNT(*) OVER() AS Total
      FROM Reviews r INNER JOIN Customers c ON c.CustomerID=r.CustomerID
      WHERE r.ProductID=@P AND r.ModerationStatus='approved'
      ORDER BY r.HelpfulVotes DESC,r.ReviewDate DESC OFFSET @Off ROWS FETCH NEXT @Lim ROWS ONLY`);
  const total = r.recordset[0]?.Total || 0;
  ok(res, { reviews:r.recordset.map(({Total,...rv})=>rv), pagination:{total,page,limit,pages:Math.ceil(total/limit)} });
}));

app.post('/api/products/:id/reviews', auth,
  [param('id').isInt(), body('rating').isInt({min:1,max:5}), body('comment').optional().isLength({max:2000})], validate,
  wrap(async (req,res) => {
    const { rating, title, comment } = req.body;
    const d = await db();
    const ex = await d.request().input('P',sql.Int,intId(req.params.id)).input('C',sql.Int,req.user.id)
      .query('SELECT 1 FROM Reviews WHERE ProductID=@P AND CustomerID=@C');
    if (ex.recordset.length) return fail(res,'You already reviewed this product',409);
    const vp = await d.request().input('C',sql.Int,req.user.id).input('P',sql.Int,intId(req.params.id))
      .query("SELECT 1 FROM OrderItems oi INNER JOIN Orders o ON o.OrderID=oi.OrderID WHERE o.CustomerID=@C AND oi.ProductID=@P AND o.Status='delivered'");
    await d.request().input('P',sql.Int,intId(req.params.id)).input('C',sql.Int,req.user.id)
      .input('R',sql.TinyInt,rating).input('T',sql.NVarChar,title||null)
      .input('Cm',sql.NVarChar,comment||null).input('V',sql.Bit,vp.recordset.length>0?1:0)
      .query('INSERT INTO Reviews(ProductID,CustomerID,Rating,Title,Comment,VerifiedPurchase) VALUES(@P,@C,@R,@T,@Cm,@V)');
    ok(res, { message:'Review submitted for moderation' }, 201);
  })
);

app.patch('/api/admin/reviews/:id', auth, adminOnly,
  [param('id').isInt(), body('moderationStatus').isIn(['pending','approved','rejected','flagged'])], validate,
  wrap(async (req,res) => {
    const { moderationStatus, reply } = req.body;
    const d = await db();
    await d.request().input('I',sql.Int,intId(req.params.id))
      .input('M',sql.NVarChar,moderationStatus).input('R',sql.NVarChar,reply||null)
      .query(`UPDATE Reviews SET ModerationStatus=@M,Reply=ISNULL(@R,Reply),
        ReplyDate=CASE WHEN @R IS NOT NULL THEN GETDATE() ELSE ReplyDate END,UpdatedAt=GETDATE()
        WHERE ReviewID=@I`);
    ok(res, { message:'Review updated' });
  })
);

app.patch('/api/reviews/:id/helpful', auth, [param('id').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  await d.request().input('I',sql.Int,intId(req.params.id))
    .query('UPDATE Reviews SET HelpfulVotes=HelpfulVotes+1 WHERE ReviewID=@I');
  ok(res, { message:'Marked helpful' });
}));

// ==============================================================
//  ⑪  WISHLIST  /api/wishlist
// ==============================================================

app.get('/api/wishlist', auth, wrap(async (req,res) => {
  const d = await db();
  const r = await d.request().input('C',sql.Int,req.user.id)
    .query(`SELECT w.WishlistID,w.ProductID,w.AddedAt,p.Name,p.Price,p.MRP,p.AverageRating,p.ImageURLs,
      p.StockQuantity,CASE WHEN p.StockQuantity=0 THEN 'out_of_stock' WHEN p.StockQuantity<=10 THEN 'low_stock' ELSE 'in_stock' END AS StockStatus
      FROM Wishlist w INNER JOIN Products p ON p.ProductID=w.ProductID
      WHERE w.CustomerID=@C ORDER BY w.AddedAt DESC`);
  ok(res, { items:r.recordset, count:r.recordset.length });
}));

app.post('/api/wishlist/:pid', auth, [param('pid').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  const ex = await d.request().input('C',sql.Int,req.user.id).input('P',sql.Int,intId(req.params.pid))
    .query('SELECT 1 FROM Wishlist WHERE CustomerID=@C AND ProductID=@P');
  if (ex.recordset.length) return ok(res, { message:'Already in wishlist' });
  await d.request().input('C',sql.Int,req.user.id).input('P',sql.Int,intId(req.params.pid))
    .query('INSERT INTO Wishlist(CustomerID,ProductID) VALUES(@C,@P)');
  ok(res, { message:'Added to wishlist' }, 201);
}));

app.delete('/api/wishlist/:pid', auth, [param('pid').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  await d.request().input('C',sql.Int,req.user.id).input('P',sql.Int,intId(req.params.pid))
    .query('DELETE FROM Wishlist WHERE CustomerID=@C AND ProductID=@P');
  ok(res, { message:'Removed from wishlist' });
}));

app.post('/api/wishlist/:pid/move-to-cart', auth, [param('pid').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  await d.request().input('C',sql.Int,req.user.id).input('P',sql.Int,intId(req.params.pid))
    .query('DELETE FROM Wishlist WHERE CustomerID=@C AND ProductID=@P');
  const cartID = await getOrCreateCart(req.user.id);
  const ex = await d.request().input('Cart',sql.Int,cartID).input('P',sql.Int,intId(req.params.pid))
    .query('SELECT CartItemID FROM CartItems WHERE CartID=@Cart AND ProductID=@P');
  if (!ex.recordset.length) await d.request().input('Cart',sql.Int,cartID).input('P',sql.Int,intId(req.params.pid)).input('Q',sql.Int,1)
    .query('INSERT INTO CartItems(CartID,ProductID,Quantity) VALUES(@Cart,@P,@Q)');
  ok(res, { message:'Moved to cart' });
}));

// ==============================================================
//  ⑫  DISCOUNTS  /api/discounts
// ==============================================================

app.post('/api/discounts/validate', auth, [body('code').notEmpty()], validate, wrap(async (req,res) => {
  const { code, orderAmount } = req.body;
  const d = await db();
  const r = await d.request().input('C',sql.NVarChar,code.toUpperCase())
    .query(`SELECT DiscountID,Code,DiscountType,DiscountPercentage,DiscountAmount,MinOrderValue,MaxDiscountAmount,Description
      FROM Discounts WHERE Code=@C AND ActiveStatus=1 AND GETDATE() BETWEEN StartDate AND EndDate
      AND (UsageLimit IS NULL OR UsageCount<UsageLimit)`);
  if (!r.recordset.length) return fail(res,'Invalid or expired coupon',404);
  const c = r.recordset[0];
  if (orderAmount && orderAmount < c.MinOrderValue) return fail(res,`Minimum order ₹${c.MinOrderValue} required`);
  let saving = c.DiscountPercentage ? Math.round((orderAmount||0)*c.DiscountPercentage/100) : (c.DiscountAmount||0);
  if (c.MaxDiscountAmount) saving = Math.min(saving, c.MaxDiscountAmount);
  ok(res, { ...c, savingAmount:saving });
}));

app.get('/api/admin/discounts', auth, adminOnly, wrap(async (req,res) => {
  const { page, limit, offset } = paginate(req.query);
  const d = await db();
  const r = await d.request().input('Lim',sql.Int,limit).input('Off',sql.Int,offset)
    .query('SELECT *,COUNT(*) OVER() AS Total FROM Discounts ORDER BY CreatedAt DESC OFFSET @Off ROWS FETCH NEXT @Lim ROWS ONLY');
  const total = r.recordset[0]?.Total || 0;
  ok(res, { discounts:r.recordset.map(({Total,...d})=>d), pagination:{total,page,limit,pages:Math.ceil(total/limit)} });
}));

app.post('/api/admin/discounts', auth, adminOnly,
  [body('code').notEmpty().trim(),
   body('discountType').isIn(['percentage','flat','bogo','free_shipping']),
   body('startDate').isISO8601(), body('endDate').isISO8601()], validate,
  wrap(async (req,res) => {
    const { code, description, discountType, discountPercentage, discountAmount, minOrderValue, maxDiscountAmount, startDate, endDate, usageLimit } = req.body;
    const d = await db();
    const r = await d.request().input('C',sql.NVarChar,code.toUpperCase()).input('D',sql.NVarChar,description||null)
      .input('T',sql.NVarChar,discountType).input('P',sql.Decimal,discountPercentage||null)
      .input('A',sql.Decimal,discountAmount||null).input('M',sql.Decimal,minOrderValue||0)
      .input('X',sql.Decimal,maxDiscountAmount||null)
      .input('S',sql.DateTime2,new Date(startDate)).input('E',sql.DateTime2,new Date(endDate))
      .input('L',sql.Int,usageLimit||null)
      .query(`INSERT INTO Discounts(Code,Description,DiscountType,DiscountPercentage,DiscountAmount,MinOrderValue,MaxDiscountAmount,StartDate,EndDate,UsageLimit)
        OUTPUT INSERTED.DiscountID VALUES(@C,@D,@T,@P,@A,@M,@X,@S,@E,@L)`);
    ok(res, { discountID:r.recordset[0].DiscountID, message:'Discount created' }, 201);
  })
);

app.put('/api/admin/discounts/:id', auth, adminOnly, [param('id').isInt()], validate, wrap(async (req,res) => {
  const { description, discountPercentage, discountAmount, minOrderValue, endDate, usageLimit, activeStatus } = req.body;
  const d = await db();
  await d.request().input('I',sql.Int,intId(req.params.id))
    .input('D',sql.NVarChar,description||null).input('P',sql.Decimal,discountPercentage||null)
    .input('A',sql.Decimal,discountAmount||null).input('M',sql.Decimal,minOrderValue!=null?minOrderValue:null)
    .input('E',sql.DateTime2,endDate?new Date(endDate):null).input('L',sql.Int,usageLimit||null)
    .input('Act',sql.Bit,activeStatus!=null?activeStatus:null)
    .query(`UPDATE Discounts SET Description=ISNULL(@D,Description),DiscountPercentage=ISNULL(@P,DiscountPercentage),
      DiscountAmount=ISNULL(@A,DiscountAmount),MinOrderValue=ISNULL(@M,MinOrderValue),
      EndDate=ISNULL(@E,EndDate),UsageLimit=ISNULL(@L,UsageLimit),ActiveStatus=ISNULL(@Act,ActiveStatus) WHERE DiscountID=@I`);
  ok(res, { message:'Discount updated' });
}));

app.delete('/api/admin/discounts/:id', auth, adminOnly, [param('id').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  await d.request().input('I',sql.Int,intId(req.params.id)).query('UPDATE Discounts SET ActiveStatus=0 WHERE DiscountID=@I');
  ok(res, { message:'Discount deactivated' });
}));

// ==============================================================
//  ⑬  AFFILIATES  /api/affiliates
// ==============================================================

app.get('/api/affiliates', auth, adminOnly, wrap(async (req,res) => {
  const { page, limit, offset } = paginate(req.query);
  const d = await db();
  const r = await d.request().input('Lim',sql.Int,limit).input('Off',sql.Int,offset)
    .query('SELECT *,COUNT(*) OVER() AS Total FROM Affiliates ORDER BY AffiliateID DESC OFFSET @Off ROWS FETCH NEXT @Lim ROWS ONLY');
  const total = r.recordset[0]?.Total || 0;
  ok(res, { affiliates:r.recordset.map(({Total,...a})=>a), pagination:{total,page,limit,pages:Math.ceil(total/limit)} });
}));

app.get('/api/affiliates/:id', auth, [param('id').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  const r = await d.request().input('I',sql.Int,intId(req.params.id)).query('SELECT * FROM Affiliates WHERE AffiliateID=@I');
  if (!r.recordset.length) return fail(res,'Affiliate not found',404);
  ok(res, r.recordset[0]);
}));

app.post('/api/affiliates', auth, adminOnly,
  [body('affiliateName').notEmpty(), body('commissionRate').isFloat({min:0,max:100})], validate,
  wrap(async (req,res) => {
    const { affiliateName, email, commissionRate, referralCode } = req.body;
    const d = await db();
    const r = await d.request().input('N',sql.NVarChar,affiliateName).input('E',sql.NVarChar,email||null)
      .input('C',sql.Decimal,commissionRate).input('R',sql.NVarChar,referralCode||null)
      .query('INSERT INTO Affiliates(AffiliateName,Email,CommissionRate,ReferralCode) OUTPUT INSERTED.AffiliateID VALUES(@N,@E,@C,@R)');
    ok(res, { affiliateID:r.recordset[0].AffiliateID, message:'Affiliate created' }, 201);
  })
);

app.put('/api/affiliates/:id', auth, adminOnly, [param('id').isInt()], validate, wrap(async (req,res) => {
  const { affiliateName, commissionRate, isActive } = req.body;
  const d = await db();
  await d.request().input('I',sql.Int,intId(req.params.id))
    .input('N',sql.NVarChar,affiliateName||null).input('C',sql.Decimal,commissionRate!=null?commissionRate:null)
    .input('A',sql.Bit,isActive!=null?isActive:null)
    .query('UPDATE Affiliates SET AffiliateName=ISNULL(@N,AffiliateName),CommissionRate=ISNULL(@C,CommissionRate),IsActive=ISNULL(@A,IsActive) WHERE AffiliateID=@I');
  ok(res, { message:'Affiliate updated' });
}));

app.delete('/api/affiliates/:id', auth, adminOnly, [param('id').isInt()], validate, wrap(async (req,res) => {
  const d = await db();
  await d.request().input('I',sql.Int,intId(req.params.id)).query('UPDATE Affiliates SET IsActive=0 WHERE AffiliateID=@I');
  ok(res, { message:'Affiliate deactivated' });
}));

// ==============================================================
//  SUPPLIERS  /api/suppliers
// ==============================================================

app.get('/api/suppliers', auth, adminOnly, wrap(async (req,res) => {
  const d = await db();
  const r = await d.request().query('SELECT * FROM Suppliers WHERE IsActive=1 ORDER BY SupplierName');
  ok(res, r.recordset);
}));

app.post('/api/suppliers', auth, adminOnly,
  [body('supplierName').notEmpty(), body('contactEmail').isEmail()], validate,
  wrap(async (req,res) => {
    const { supplierName, contactName, contactEmail, phoneNumber, city, country } = req.body;
    const d = await db();
    const r = await d.request().input('N',sql.NVarChar,supplierName).input('CN',sql.NVarChar,contactName||null)
      .input('E',sql.NVarChar,contactEmail).input('P',sql.NVarChar,phoneNumber||null)
      .input('C',sql.NVarChar,city||null).input('Co',sql.NVarChar,country||'India')
      .query('INSERT INTO Suppliers(SupplierName,ContactName,ContactEmail,PhoneNumber,City,Country) OUTPUT INSERTED.SupplierID VALUES(@N,@CN,@E,@P,@C,@Co)');
    ok(res, { supplierID:r.recordset[0].SupplierID, message:'Supplier created' }, 201);
  })
);

// ==============================================================
//  ADMIN DASHBOARD  /api/admin/dashboard
// ==============================================================

app.get('/api/admin/dashboard', auth, adminOnly, wrap(async (req,res) => {
  const s = new Date(req.query.start || Date.now()-30*86400*1000);
  const e = new Date(req.query.end   || Date.now());
  const d = await db();
  const [kpis,newCust,lowStock,topProds,recentOrders] = await Promise.all([
    d.request().input('S',sql.DateTime2,s).input('E',sql.DateTime2,e)
      .query(`SELECT COUNT(*) AS TotalOrders,
        SUM(CASE WHEN Status NOT IN('cancelled','refunded') THEN TotalAmount ELSE 0 END) AS Revenue,
        AVG(CASE WHEN Status NOT IN('cancelled','refunded') THEN TotalAmount END) AS AvgOrderValue,
        COUNT(CASE WHEN Status='cancelled' THEN 1 END)*100.0/NULLIF(COUNT(*),0) AS CancellationRate
        FROM Orders WHERE OrderDate BETWEEN @S AND @E`),
    d.request().input('S',sql.DateTime2,s).input('E',sql.DateTime2,e)
      .query('SELECT COUNT(*) AS NewCustomers FROM Customers WHERE RegistrationDate BETWEEN @S AND @E'),
    d.request().query('SELECT TOP 10 ProductID,Name,SKU,StockQuantity,ReorderLevel FROM Products WHERE StockQuantity<=ReorderLevel AND IsActive=1 ORDER BY StockQuantity'),
    d.request().input('S',sql.DateTime2,s).input('E',sql.DateTime2,e)
      .query(`SELECT TOP 10 p.Name,SUM(oi.Quantity) AS UnitsSold,SUM(oi.Quantity*oi.UnitPrice) AS Revenue
        FROM OrderItems oi INNER JOIN Products p ON p.ProductID=oi.ProductID INNER JOIN Orders o ON o.OrderID=oi.OrderID
        WHERE o.Status NOT IN('cancelled','refunded') AND o.OrderDate BETWEEN @S AND @E GROUP BY p.Name ORDER BY Revenue DESC`),
    d.request().query(`SELECT TOP 5 o.OrderID,o.OrderDate,o.TotalAmount,o.Status,c.FirstName+' '+c.LastName AS CustomerName
      FROM Orders o INNER JOIN Customers c ON c.CustomerID=o.CustomerID ORDER BY o.OrderDate DESC`),
  ]);
  ok(res, { kpis:kpis.recordset[0], newCustomers:newCust.recordset[0].NewCustomers, lowStockAlerts:lowStock.recordset, topProducts:topProds.recordset, recentOrders:recentOrders.recordset });
}));

// ==============================================================
//  SEARCH  /api/search
// ==============================================================

app.get('/api/search',
  [query('q').notEmpty().isLength({min:2}).withMessage('Query must be at least 2 characters')], validate,
  wrap(async (req,res) => {
    const { q, limit=10, type='all' } = req.query;
    const d = await db();
    const results = {};
    if (type==='all'||type==='products') {
      const r = await d.request().input('Q',sql.NVarChar,`%${q}%`).input('L',sql.Int,parseInt(limit))
        .query('SELECT TOP(@L) ProductID,Name,Price,AverageRating,ImageURLs FROM Products WHERE IsActive=1 AND (Name LIKE @Q OR Brand LIKE @Q OR Tags LIKE @Q) ORDER BY ViewsCount DESC');
      results.products = r.recordset;
    }
    if (type==='all'||type==='categories') {
      const r = await d.request().input('Q',sql.NVarChar,`%${q}%`)
        .query('SELECT CategoryID,CategoryName FROM Categories WHERE CategoryName LIKE @Q AND IsActive=1');
      results.categories = r.recordset;
    }
    ok(res, results);
  })
);

// ── SWAGGER DOCS ──────────────────────────────────────────────
app.get('/api-docs',      (req,res) => res.sendFile(path.join(__dirname,'public','api-docs.html')));
app.get('/api-spec.json', (req,res) => res.sendFile(path.join(__dirname,'public','api-spec.json')));

// ── CATCH-ALL ────────────────────────────────────────────────
app.get('*', (req,res) => {
  if (req.path.startsWith('/api')) return fail(res,'Endpoint not found',404);
  res.sendFile(path.join(__dirname,'public','index.html'));
});

// ── ERROR HANDLER ─────────────────────────────────────────────
app.use((err,req,res,_next) => {
  console.error('❌',err.message);
  const status = err.message?.includes('not found')?404:err.message?.includes('stock')?400:500;
  const msg = process.env.NODE_ENV==='production'?'Internal server error':err.message;
  fail(res,msg,status);
});

// ── START ────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║   DEEMONA REST API SERVER v1.0               ║
  ╠══════════════════════════════════════════════╣
  ║   API Base  : http://localhost:${PORT}/api      ║
  ║   Swagger   : http://localhost:${PORT}/api-docs ║
  ║   Health    : http://localhost:${PORT}/api/ping ║
  ╚══════════════════════════════════════════════╝`);
  try { await db(); } catch(e) { console.warn('⚠  DB offline:',e.message); }
});

module.exports = app;
