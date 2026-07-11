import HudApp from '@/components/hud/HudApp';
import AngelsPanel from '@/components/AngelsPanel';
import CorpusPanel from '@/components/CorpusPanel';
import GodMode from '@/components/GodMode';
import JarvisHud from '@/components/JarvisHud';
import MaxCore3D from '@/components/hud/MaxCore3D';
import SageMode from '@/components/SageMode';
import MissionTracker from '@/components/MissionTracker';
import ClusterPanel from '@/components/ClusterPanel';
import DoctorDashboard from '@/components/DoctorDashboard';
import PhaseDay from '@/components/PhaseDay';
import ResonanceCore from '@/components/hud/ResonanceCore';
import SkillInventory from '@/components/SkillInventory';

export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden">
      <AngelsPanel />
      <CorpusPanel />
      <GodMode />
      <JarvisHud />
      <MaxCore3D />
      <SageMode />
      <MissionTracker />
      <ClusterPanel />
      <DoctorDashboard />
      <PhaseDay />
      <ResonanceCore />
      <SkillInventory />
      <HudApp />
    </main>
  );
}
