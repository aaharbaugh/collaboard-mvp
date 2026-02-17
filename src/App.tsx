import { AuthGate } from './features/auth/AuthGate';
import { BoardView } from './features/board/BoardView';

function App() {
  return (
    <AuthGate>
      <BoardView />
    </AuthGate>
  );
}

export default App;
