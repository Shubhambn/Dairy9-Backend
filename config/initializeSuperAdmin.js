// config/initializeSuperAdmin.js
import User from '../models/user.model.js';
import bcrypt from 'bcryptjs';

export async function initializeSuperAdmin() {
  try {
    const phone = process.env.SUPERADMIN_PHONE ;
    const secret = process.env.SUPERADMIN_SECRET;

    let superAdmin = await User.findOne({ role: 'superadmin' });

    if (!superAdmin) {
      const hashedSecret = await bcrypt.hash(secret, 10);

      superAdmin = new User({
        phone,
        role: 'superadmin',
        isVerified: true,
        superadminPassword: hashedSecret
      });

      await superAdmin.save();
      console.log('👑 SuperAdmin created successfully with phone:', phone);
    } else {
      console.log('✅ SuperAdmin already exists');
    }
  } catch (error) {
    console.error('❌ Error initializing SuperAdmin:', error);
  }
}
