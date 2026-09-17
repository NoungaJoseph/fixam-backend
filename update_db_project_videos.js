process.env.DATABASE_URL = "postgresql://postgres.bvzebfcjirnrcjxxdjrt:FixamSecure2026@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true";

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const VIDEO_URLS = [
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4'
];

async function updateVideos() {
  console.log('Updating database portfolio project video URLs using pooler port 6543...');
  try {
    const profiles = await prisma.providerProfile.findMany({});
    
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      if (profile.portfolio && Array.isArray(profile.portfolio)) {
        const videoUrl = VIDEO_URLS[i % VIDEO_URLS.length];
        const updatedPortfolio = profile.portfolio.map(proj => ({
          ...proj,
          video: videoUrl,
          videoUrl: videoUrl,
          videos: [videoUrl]
        }));
        
        await prisma.providerProfile.update({
          where: { id: profile.id },
          data: { portfolio: updatedPortfolio }
        });
        
        console.log(`Updated video for profile: ${profile.id} to ${videoUrl}`);
      }
    }
    console.log('Database portfolio video updates completed!');
  } catch (error) {
    console.error('Error updating videos:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateVideos();
