import express from 'express';
import multer from 'multer';
import { protect } from '../middlewares/authMiddleware.js';
import { 
    createGroup, 
    joinGroup,
    groupDetailsEdit, 
    getMyGroup, 
    getGroupInviteCode, 
    getGroupDetails,
    exitGroup,
    removeMember,
    deleteGroup,
    transferAdmin,
    listMembers,
    updateMemberFlags 
} from '../controllers/groupController.js';

const router = express.Router();
const upload = multer({ dest: 'temp/' });

router.post('/create', protect, upload.single('groupImage'), createGroup);
router.post('/join', protect, joinGroup);
router.patch('/:id/goup-edit', protect, upload.single('groupImage'), groupDetailsEdit);
router.get('/my-groups', protect, getMyGroup);
router.get('/:id/invite-code', protect, getGroupInviteCode);
router.get('/:id/details', protect, getGroupDetails);
router.delete('/:id/exit', protect, exitGroup); //For member exit
router.patch('/:id/remove-member/:memberId', protect, removeMember); //Admin remove member
router.delete('/:id', protect, deleteGroup); //Admin Delete Group

//group member
router.patch('/:id/transfer-admin/:memberId', protect, transferAdmin); //transfer Admin
router.get('/:id/members', protect, listMembers); //Get group Members
router.patch('/:id/members/:memberId', protect, updateMemberFlags);// pin and mute

export default router;
