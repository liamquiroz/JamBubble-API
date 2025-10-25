//process.env.TZ = 'UTC';
import http from 'http';
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { log, error} from './src/utils/logger.js'
import connectDB from './src/config/db.js';
import { scheduleOtpCleanup } from './src/cron/cleanOtp.js';
import { scheduleTempCleanup } from './src/cron/cleanTemp.js';
import groupRoutes from './src/routes/groupRoutes.js';

//track
import { fileURLToPath } from 'url';
import path from 'path';

//Routers
import authRoutes from './src/routes/authRoutes.js';
import musicRoutes from './src/routes/musicRoutes.js';
import uploadProfilePic from './src/routes/userRoutes.js';
import playlistRoutes from './src/routes/playlistRoutes.js';

//share Link & invite link
import inviteShareRoutes from './src/routes/inviteShareRoutes.js';
import publicInviteRoutes from './src/routes/publicInviteRoutes.js';
import {initSendGrid} from './src/services/inviteMail.js';
import {initTwilio} from './src/services/inviteSms.js';

//socket
import { initSocket } from './src/realtime/index.js';
import { startPresenceSweeper } from './src/realtime/presence/job/presence.sweeper.js';

//get data from cloud in json
import jsonRegistryRoutes from './src/routes/jsonRegistryRoutes.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

//for local path
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

//test Route
app.get('/123', (req, res) => {
    res.send('Server chalu... :)');
});

app.use('/api/auth', authRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/user', uploadProfilePic);
app.use('/api/group', groupRoutes);
app.use('/api/playlists', playlistRoutes);
app.use(express.static('public'));

//sahre and Invite Link Routes
app.use('/api/link/', inviteShareRoutes);
app.use('/',publicInviteRoutes);

//DB Connection
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
initSocket(server);

startPresenceSweeper();

initSendGrid();
initTwilio();

//json get from cloud
app.use('/api', jsonRegistryRoutes);

connectDB().then(() => {
 server.listen(PORT, () => {
        log(`Server running on port ${PORT}.`);
        scheduleOtpCleanup();
        scheduleTempCleanup();
        log( "server time is:", new Date().toString());
    });
});

