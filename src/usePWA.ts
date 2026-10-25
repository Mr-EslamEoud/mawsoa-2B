import { useState, useEffect } from 'react';

export const usePWA = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBtn, setShowInstallBtn] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [showIOSInstallGuide, setShowIOSInstallGuide] = useState<boolean>(false);
  const [installTab, setInstallTab] = useState<'android' | 'ios' | 'pc'>('android');

  useEffect(() => {
    // Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /ipad|iphone|ipod/.test(userAgent) && !(window as any).MSStream;
    setIsIOS(isIosDevice);
    if (isIosDevice) {
      setInstallTab('ios');
    } else {
      const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
      if (isMobile) {
        setInstallTab('android');
      } else {
        setInstallTab('pc');
      }
    }

    const checkStandalone = () => {
      const isStandaloneMode = (window.navigator as any).standalone || 
                               window.matchMedia('(display-mode: standalone)').matches ||
                               window.matchMedia('(display-mode: fullscreen)').matches ||
                               window.matchMedia('(display-mode: minimal-ui)').matches;
      return isStandaloneMode;
    };

    if (checkStandalone()) {
      setShowInstallBtn(false);
    } else {
      const earlyPrompt = (window as any).deferredPrompt;
      if (earlyPrompt) {
        setDeferredPrompt(earlyPrompt);
        setShowInstallBtn(true);
      } else if (isIosDevice) {
        setShowInstallBtn(true);
      } else {
        setShowInstallBtn(false);
      }
    }

    const handlePromptAvailable = (e: any) => {
      if (!checkStandalone()) {
        setDeferredPrompt((window as any).deferredPrompt || e);
        setShowInstallBtn(true);
      }
    };

    const handleInstalled = () => {
      setShowInstallBtn(false);
      setDeferredPrompt(null);
    };
    
    if ((window as any).deferredPrompt) {
      handlePromptAvailable((window as any).deferredPrompt);
    } else if (isIosDevice && !checkStandalone()) {
      setShowInstallBtn(true);
    }

    window.addEventListener('pwa-prompt-available', handlePromptAvailable);
    window.addEventListener('pwa-installed', handleInstalled);
    
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      (window as any).deferredPrompt = e;
      if (!checkStandalone()) {
        setShowInstallBtn(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('beforeinstallprompt', handlePromptAvailable);

    return () => {
      window.removeEventListener('pwa-prompt-available', handlePromptAvailable);
      window.removeEventListener('pwa-installed', handleInstalled);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  return {
    deferredPrompt, setDeferredPrompt,
    showInstallBtn, setShowInstallBtn,
    isIOS,
    showIOSInstallGuide, setShowIOSInstallGuide,
    installTab, setInstallTab
  };
};