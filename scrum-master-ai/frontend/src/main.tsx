import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// StrictMode is intentionally not used here — its dev-only double-invoke of
// effects caused the WebSocket layer to open/close/reopen on every mount,
// which was more disruptive than the bug-surfacing it's meant to provide
// for this app's shape.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
