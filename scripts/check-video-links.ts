import { db } from '@/lib/db';
import { shots, shotAssets } from '@/lib/db/schema';
import { eq, inArray, asc } from 'drizzle-orm';

const projectId = 'SKB6CNwqAn5H';

async function main() {
  const projectShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(asc(shots.sequence));
  
  console.log(`Total shots: ${projectShots.length}`);
  
  const shotIds = projectShots.map(s => s.id);
  const assets = await db
    .select()
    .from(shotAssets)
    .where(inArray(shotAssets.shotId, shotIds));
  
  console.log(`\nShot video status:`);
  for (const s of projectShots) {
    const videoAssets = assets.filter(
      a => a.shotId === s.id && 
      (a.type === 'keyframe_video' || a.type === 'reference_video') && 
      a.isActive === 1
    );
    const hasVideo = videoAssets.length > 0;
    console.log(`Shot ${s.sequence}: assets=${videoAssets.length}, linked=${hasVideo ? 'YES' : 'NO'}`);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
