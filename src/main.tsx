import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// حجب سجلات التصحيح والتتبع في بيئة الإنتاج لحماية خصوصية بيانات الطلاب
if (import.meta.env.PROD) {
  console.debug = () => {};
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
