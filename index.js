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
    // Clean up the inputs by trimming any trailing whitespaces
    // And for the email, set all to lowercase for easier validation
    const username = req.body.username?.trim();
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    // Validation checks
    if (!username || !email || !password) {
        return res.status(400).json({ error: "Username, email and password are required." });
    }
    if (username.length < 3 || username.length > 100) {
        return res.status(400).json({ error: "Username must be between 3 and 100 characters." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
        return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    try{
        // Hash the password with bcrypt at cost value of 12 and insert it into the database
        const hashedPassword = await bcrypt.hash(password, 12);
        const result = await pool.query(`
            INSERT INTO users (username, email, password) VALUES ($1, $2, $3)
            RETURNING id, username, email, created_at
        `, [username, email, hashedPassword])
        res.status(201).json(result.rows[0]);
    }catch(err){
        // 23505 = unique constraint violation, i.e. the email is already registered
        if (err.code === '23505') {
            return res.status(409).json({ error: "An account with this email already exists." });
        }
        console.error(err);
        res.status(500).json({ error: "Something went wrong." });
    }
})

app.post('/login', async (req, res) => {
    // Get the email and password from the input
    const {email, password} = req.body;
    try{
        // Find the account with the matching email
        // Email converted to lowercase for easier validation
        const result = await pool.query(`
            SELECT id, email, password FROM users
            WHERE LOWER(email) = LOWER($1)
        `, [email?.trim()]);
        // Return error if none found
        if(result.rows.length === 0){
            return res.status(404).json({ error: "Invalid username or password." })
        }

        // Get the user object from the result
        // And compare the input password with the fetched hased password, then return true or false
        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password);

        // If false, return error
        if (!valid) {
            return res.status(401).json({ error: "Invalid username or password." });
        }

        // If true, sign an access token and a refresh token
        // Access token is used to verify the user's current session for each action they do
        // Refresh token is used to get a new access token when it expires
        const accessToken = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );
        const refreshToken = jwt.sign(
            { userId: user.id, email: user.email },
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
    // Checks for the refresh token to see if it exists
    const { refreshToken } = req.body;
    if (!refreshToken) {
        return res.status(401).json({ error: 'Missing refresh token' });
    }
    // Verify the refresh token to see if it's valid and not forged
    jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, (err, decoded) => {
        // If invalid/forged, return error
        if (err) {
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }
        // Else, using the JWT_SECRET, sign a new access token
        const accessToken = jwt.sign(
            { userId: decoded.userId, email: decoded.email },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );
        res.json({ accessToken });
    });
});

function verifyToken(req, res, next) {
    // Fetch the token from the Authorization header
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).end();
    const token = auth.split(' ')[1];
    // Verify the token against the JWT_SECRET
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        // If invalid, return 401 error and stop the route from proceeding
        if (err) return res.status(401).end();
        // Else, proceed with the decoded user credentials
        req.user = decoded;
        next();
    });
}

app.post('/posts', verifyToken, async (req, res) => {
    const user_id = req.user.userId;
    const { title, content, visibility } = req.body;

    const titleVal = title || null;

    if(!content){
        return res.status(404).json({ error: "The content field is not filled in. Please try again." })
    }
    try{
        const result = await pool.query(`
            INSERT INTO posts (user_id, title, content, visibility)
            VALUES ($1, $2, $3, $4)
            RETURNING *    
        `, [user_id, titleVal, content, visibility]);
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

app.get('/users', verifyToken, async (req, res) => {
    // Select all users except for the one you log in as
    try{
        const result = await pool.query(`
            SELECT id, username, email, created_at FROM users
            WHERE id <> $1
        `, [req.user.userId]);
        res.json(result.rows);
    }catch(err){
        console.error(err);
        res.status(500).json({ error: "Something went wrong, please check back again later.", err });
    }
});

app.post('/friendships', verifyToken, async (req, res) => {
    // Select all friendships
    const { friend_id } = req.body;
    try{
        const result = await pool.query(`
            INSERT INTO friendships (user_id, friend_id)
            VALUES ($1, $2)
            RETURNING *    
        `, [req.user.userId, friend_id]);
        res.status(201).json({ message: "Friend added successfully", result: result.rows[0] })
    }catch(err){
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

app.get('/friendships', verifyToken, async (req, res) => {
    try{
        // Only return the people the logged in user is following
        const result = await pool.query(`
            SELECT * FROM friendships
            WHERE user_id = $1
        `, [req.user.userId]);
        res.json(result.rows);
    }catch(err){
        console.error(err);
        res.status(500).json({ error: "Something went wrong, please check back again later.", err });
    }
});

app.delete('/friendships/:id', verifyToken, async (req, res) => {
    try{
        // Delete from the friendships table
        // Where the friend of a user_id is targeted and deleted
        const result = await pool.query(`
            DELETE FROM friendships
            WHERE user_id = $1 AND friend_id = $2
            RETURNING *
        `, [req.user.userId, req.params.id]);
        if(result.rows.length === 0){
            return res.status(404).json({ error: "You are not following this user." });
        }
        res.json({ message: "Friend removed successfully", result: result.rows[0] });
    }catch(err){
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// Middleware for invalid routes
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Roundtable API listening on port ${PORT}`);
});