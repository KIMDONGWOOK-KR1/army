import GameApp from "./game-app";
export default function AppShell({ joinCode = "" }: { joinCode?: string }) {
  return <GameApp joinCode={joinCode} />;
}
