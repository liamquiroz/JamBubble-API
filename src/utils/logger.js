import dotenv from 'dotenv';
dotenv.config();

const logEnabled = process.env.LOG === 'true';

export const log = (...args) => {
   if (logEnabled) console.log(`[LOG]:`, ...args);
};

export const error = (...args) => {
    if (logEnabled) console.error(`[ERROR]`, ...args);
};