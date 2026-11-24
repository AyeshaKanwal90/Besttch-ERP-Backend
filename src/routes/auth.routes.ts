import { Router } from "express";
import * as authController from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";
import {
  forgotPasswordRateLimiter,
  loginRateLimiter,
  resetPasswordRateLimiter,
} from "../middleware/rateLimit";

const router = Router();

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Login user
 *     description: Authenticate a user using email and password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: admin@besttech.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: ChangeThisImmediately123!
 *     responses:
 *       200:
 *         description: Logged in successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Invalid email or password
 *       429:
 *         description: Too many login attempts
 *       500:
 *         description: Internal server error
 */
router.post("/login", loginRateLimiter, authController.login);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Logout user
 *     description: Logs out the currently authenticated user.
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       500:
 *         description: Internal server error
 */
router.post("/logout", authController.logout);

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Request a password reset link
 *     description: >
 *       Emails a single-use reset link valid for 1 hour
 *       ($APP_URL/reset-password?token=...). Always returns 200 with the
 *       same message so it can't reveal which emails are registered.
 *       Requesting a new link invalidates earlier ones. Without SMTP
 *       configured, the email is printed to the server console.
 *       Rate limited to 5 requests per 15 minutes per IP.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: admin@besttech.com
 *     responses:
 *       200:
 *         description: Request accepted (whether or not the account exists)
 *       422:
 *         description: Not a valid email address
 *       429:
 *         description: Too many requests
 */
router.post("/forgot-password", forgotPasswordRateLimiter, authController.forgotPassword);

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Set a new password with a reset token
 *     description: >
 *       Uses the token from the reset email. Each token works once and
 *       expires after 1 hour; using it also invalidates any other
 *       outstanding links for the account. Rate limited to 10 attempts
 *       per 15 minutes per IP.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - password
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password changed
 *       400:
 *         description: Token invalid, expired or already used
 *       422:
 *         description: Validation failed (e.g. password too short)
 *       429:
 *         description: Too many attempts
 */
router.post("/reset-password", resetPasswordRateLimiter, authController.resetPassword);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Get current user
 *     description: Returns the currently authenticated user's profile, including a `permissions` array (the role's effective permissions) for showing or hiding UI. Login and profile updates return the same shape. Available to every role, including client.
 *     responses:
 *       200:
 *         description: Current user retrieved successfully
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.get("/me", requireAuth, authController.me);

/**
 * @openapi
 * /auth/me:
 *   put:
 *     tags:
 *       - Authentication
 *     summary: Update current user profile
 *     description: Updates profile information for the currently authenticated user.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *             properties:
 *               name:
 *                 type: string
 *                 example: System Administrator
 *               phone:
 *                 type: string
 *                 example: "+441234567890"
 *               avatarUrl:
 *                 type: string
 *                 nullable: true
 *                 example: "https://example.com/avatar.jpg"
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.put("/me", requireAuth, authController.updateProfile);

export default router;
