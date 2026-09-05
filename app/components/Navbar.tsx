'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link href="/" className="nav-brand">
          <span>MERCHANT-AGENT</span>
          <span className="brand-badge">Autonomous</span>
        </Link>
        <nav className="nav-links">
          <Link href="/" className={`nav-link ${pathname === '/' ? 'active' : ''}`}>
            Storefront
          </Link>
          <Link href="/browse" className={`nav-link ${pathname.startsWith('/browse') ? 'active' : ''}`}>
            Browse
          </Link>
          <Link href="/audit" className={`nav-link ${pathname.startsWith('/audit') ? 'active' : ''}`}>
            Audit Trail
          </Link>
          <Link href="/policy" className={`nav-link ${pathname.startsWith('/policy') ? 'active' : ''}`}>
            Policy Engine
          </Link>
          <Link href="/control" className={`nav-link ${pathname.startsWith('/control') ? 'active' : ''}`}>
            Control Panel
          </Link>
        </nav>
      </div>
    </header>
  );
}
