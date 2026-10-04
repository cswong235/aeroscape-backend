# ![Aeroscape logo](./AeroscapeAPI.png)

The backend API for the Aeroscape site.

The Aeroscape site:
- Railway link: https://aeroscape-frontend.vercel.app/
- GitHub repo: https://github.com/cswong235/aeroscape-frontend

## Routes

1. GET / — serves the API's landing page.
2. POST /signup — create a new account. Body: `username` (3-100 characters), `email`, `password` (at least 8 characters).
3. POST /login — log in and get an access token (15 minutes) and a refresh token (7 days). Body: `email`, `password`.
4. POST /refresh — exchange a refresh token for a new access token. Body: `refreshToken`.
5. POST /posts — create a post as the logged-in user. Body: `content`, and optionally `title`, `visibility` (`public` or `friends_only`).
6. GET /posts — fetch the posts the logged-in user can see: public posts, their own posts, and friends-only posts from authors who added them, joined with each author's username.
7. GET /users — fetch all users except the logged-in user.
8. POST /friendships — add a user as a friend. Body: `friend_id`.
9. GET /friendships — fetch everyone the logged-in user has added.
10. DELETE /friendships/:id — remove a friend, where `:id` is the friend's user id.

Routes 5 to 10 require authentication via the `verifyToken` function which reads the access token from the Authorization header.

## Other info
Built with:
- JavaScript
- Node
- Express
- PostgreSQL
- JWT
- Supabase

## Links
- Vercel link: https://aeroscape-backend.vercel.app/
