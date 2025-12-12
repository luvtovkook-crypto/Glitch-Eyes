import React from 'react';
import { MirrorCanvas } from './components/MirrorCanvas';

const App: React.FC = () => {
  return (
    <main className="w-screen h-screen bg-black overflow-hidden">
      <MirrorCanvas />
    </main>
  );
};

export default App;