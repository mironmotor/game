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
import ReflectionLoop from '@/components/ReflectionLoop';
import AuraBinaural from '@/components/AuraBinaural';
import GameBuddy from '@/components/GameBuddy';
import MaxBrain from '@/components/MaxBrain';
import MirCoinPanel from '@/components/MirCoinPanel';
import SleepMode from '@/components/SleepMode';
import MirWallet from '@/components/MirWallet';
import ResonanceCore from '@/components/hud/ResonanceCore';
import SkillInventory from '@/components/SkillInventory';
import AttractorViz from '@/components/AttractorViz';
import AdminPanel from '@/components/AdminPanel';
import DreamViz3D from '@/components/DreamViz3D';
import EtherScan3D from '@/components/EtherScan3D';
import MoneyAgent from '@/components/MoneyAgent';
import MultiAgent from '@/components/MultiAgent';
import MissionAutopilot from '@/components/MissionAutopilot';
import AgentRunner from '@/components/AgentRunner';
import CyberLab from '@/components/CyberLab';
import CoreFlow3D from '@/components/CoreFlow3D';
import ModeMenu from '@/components/ModeMenu';

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
      <ReflectionLoop />
      <AuraBinaural />
      <GameBuddy />
      <MaxBrain />
      <MirCoinPanel />
      <SleepMode />
      <MirWallet />
      <ResonanceCore />
      <SkillInventory />
      <AttractorViz />
      <AdminPanel />
      <DreamViz3D />
      <EtherScan3D />
      <MoneyAgent />
      <MultiAgent />
      <MissionAutopilot />
      <AgentRunner />
      <CyberLab />
      <CoreFlow3D />
      <HudApp />
      <ModeMenu />
    </main>
  );
}
