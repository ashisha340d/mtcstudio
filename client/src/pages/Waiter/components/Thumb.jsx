import { useEffect, useState } from 'react';
import { imgSrc, imgSrcForApp } from '../lib/img';

// CMS photo that cross-fades in once decoded. Tries the compressed forapp
// webp export first (same one the companion Android app syncs), falls back
// to the original upload if that export doesn't exist yet, then to the
// fallback icon so a broken image never leaves a hole in the grid.
export default function Thumb({ src, alt = '', fallback = null, className = '' }) {
  const [loaded, setLoaded] = useState(false);
  const [useFallbackUrl, setUseFallbackUrl] = useState(false);
  const [failed, setFailed] = useState(false);
  const appUrl = imgSrcForApp(src);
  const origUrl = imgSrc(src);
  const url = useFallbackUrl ? origUrl : appUrl;

  useEffect(() => { setLoaded(false); setUseFallbackUrl(false); setFailed(false); }, [src]);

  const empty = !url || failed;
  return (
    <span className={`${className}${empty ? ' is-empty' : ''}`}>
      {fallback}
      {url && !failed && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={loaded ? 'is-loaded' : ''}
          onLoad={() => setLoaded(true)}
          onError={() => { if (!useFallbackUrl && origUrl !== appUrl) setUseFallbackUrl(true); else setFailed(true); }}
        />
      )}
    </span>
  );
}
