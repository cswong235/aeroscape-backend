let express = require('express');
let path = require('path');
let app = express();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { Pool } = require('pg');
require('dotenv').config();
const cors = require('cors');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

app.use(cors());
app.use(express.json());

// Default route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname + '/index.html'));
})

app.post('/signup', async (req, res) => {
    const {username, email, password} = req.body;
    // Add username, email and password validation later
    try{
        const hashedPassword = await bcrypt.hash(password, 12);
        const result = await pool.query(`
            INSERT INTO users (username, email, password) VALUES ($1, $2, $3)
            RETURNING *
        `, [username, email, hashedPassword])
        res.status(201).json(result.rows[0]);
    }catch(err){
        console.error(err);
        res.status(500).json({ error: "Something went wrong." });
    }
})

app.post('/login', async (req, res) => {
    const {email, password} = req.body;
    try{
        const result = await pool.query(`
            SELECT id, email, password FROM users
            WHERE email = $1
        `, [email]);
        if(result.rows.length === 0){
            return res.status(404).json({ error: "No matching users found." })
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password);

        if (!valid) {
            return res.status(401).json({ error: "Invalid username or password" });
        }

        const accessToken = jwt.sign(
            { userId: user.id, username: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );
        const refreshToken = jwt.sign(
            { userId: user.id, username: user.email },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({ accessToken, refreshToken });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

app.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ error: 'Missing refresh token' });
  }
  jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    const accessToken = jwt.sign(
      { userId: decoded.userId, email: decoded.email },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
    res.json({ accessToken });
  });
});

function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).end();
  const token = auth.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).end();
    req.user = decoded;
    next();
  });
}

app.post('/posts', verifyToken, async (req, res) => {
    const { user_id, title, content, visibility } = req.body;
    if(!title || !content){
        return res.status(404).json({ error: "Some fields are not filled in. Please try again." })
    }
    try{
        const result = await pool.query(`
            INSERT INTO posts (user_id, title, content, visibility)
            VALUES ($1, $2, $3, $4)
            RETURNING *    
        `, [user_id, title, content, visibility]);
        res.status(201).json({ message: "Post added successfully", result: result.rows[0] })
    }catch(err){
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
})

app.get('/posts', verifyToken, async (req, res) => {
    try{
        const currentUserId = req.user.userId;

        // Select all post fields from the posts table, and the username field from the users table
        // Join on the id to know which post belongs to which user
        // Only return the public posts, or
        // Friends-only posts where only posts from users the current logged in user is a friend of
        const result = await pool.query(`
            SELECT p.*, u.username AS username
            FROM posts p
            LEFT JOIN users u ON p.user_id = u.id
            WHERE p.visibility = 'public'
                OR p.user_id = $1
                OR (
                    p.visibility = 'friends_only'
                    AND p.user_id IN (
                        SELECT user_id FROM friendships WHERE friend_id = $1
                    )
                )
        `, [currentUserId]);
        res.json(result.rows);
    }catch(err){
        console.error(err);
        res.status(500).json({ error: "Something went wrong, please check back again later.", err });
    }
})

app.post('/friendships', verifyToken, async (req, res) => {
    const {user_id, friend_id} = req.body;
    // Add validation for valid user_id and friend_id
    try{
        const result = await pool.query(`
            INSERT INTO friendships (user_id, friend_id)
            VALUES ($1, $2)
            RETURNING *    
        `, [user_id, friend_id]);
        res.status(201).json({ message: "Friend added successfully", result: result.rows[0] })
    }catch(err){
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
})

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Roundtable API listening on port ${PORT}`);
});