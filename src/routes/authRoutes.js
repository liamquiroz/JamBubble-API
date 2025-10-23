// src/routes/authRoutes.js
import express from 'express';
import {
  // Signup
  signupUser,
  sendSignupEmailOtp,
  verifySignupOtp,
  // Login
  loginUser,            
  loginOtpStart,       
  loginOtpStartEmail,   
  loginOtpVerify,       
  // Forgot
  forgotPassword,       
  forgotPasswordEmail,  
  verifyResetOtp,
  resetPassword,
  // Checkers
  checkEmailExists,
  checkMobileExists,
} from '../controllers/authController.js';

const router = express.Router();

//Signup
router.post('/signup', signupUser); //SMS
router.post('/signup/otp/email', sendSignupEmailOtp); //Email
router.post('/signup/verify', verifySignupOtp); //Verify

//Login
router.post('/login', loginUser);                 // password (mobileNo)
router.post('/login-otp', loginOtpStart);   // SMS
router.post('/login-otp-email', loginOtpStartEmail); // Email
router.post('/login-otp-verify', loginOtpVerify); // verify

//Forgot
router.post('/forgot-password', forgotPassword);            // SMS
router.post('/forgot-password/email', forgotPasswordEmail); // Email
router.post('/verify-reset-otp', verifyResetOtp);
router.post('/reset-password', resetPassword);

//Uniqueness Checks
router.post('/check-email', checkEmailExists);
router.post('/check-mobile', checkMobileExists);

export default router;
