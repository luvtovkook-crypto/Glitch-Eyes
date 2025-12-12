import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  // StrictMode can sometimes cause double-initialization issues with complex external libs like MediaPipe in dev.
  // We keep it off here for stability of the camera stream in this specific demo context.
  <App />
);