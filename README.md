# Blog Platform(MERN): Post Creation

## Overview

This is a blogging platform where users can discover, read, and share blog posts.

However, users are unable to create and publish new blog posts, even when they correctly fill in all required fields. Your task is to fix this backend issue.

## Expected API Behavior

### POST /api/posts

**Purpose**
Creates a new blog post for the authenticated user and returns the created post.

**Request Headers**
```json
{
  "x-user-id": "string",     // MongoDB ObjectId of authenticated user
  "Content-Type": "application/json"
}
```

**Request Body**
```json
{
  "title": "string",        // Required: Post title
  "content": "string",      // Required: Full post content
  "excerpt": "string",      // Optional: Short description
  "category": "string",     // Required: Technology or Lifestyle or so on
  "tags": ["string"],       // Optional: Array of tag strings
  "readTime": "number"      // Optional: Estimated read time in minutes
}
```

**Success Response (201)**
```json
{
  "message": "Post created successfully",
  "post": {
    "_id": "string",           // MongoDB ObjectId
    "title": "string",         // Provided title
    "content": "string",       // Provided content
    "excerpt": "string",       // Provided or auto-generated
    "category": "string",      // Provided category
    "tags": ["string"],        // Provided tags or empty array
    "readTime": "number",      // Provided
    "published": true,         // Always true
    "author": {
      "_id": "string",         // User ObjectId
      "name": "string",        // User name
      "email": "string",       // User email
      "bio": "string"          // User bio
    },
    "createdAt": "ISO string", // Creation timestamp
    "updatedAt": "ISO string"  // Update timestamp
  }
}
```

## Additional Information

- The post should be saved to the database as they are created.
- The published status should be set to true when a post is created.
- If an excerpt isn’t provided, the first 150 characters of the content should be used automatically. 
- To manually reset the database, stop the running server and then restart it.
- Running the test cases will also restore the database to its initial state.
