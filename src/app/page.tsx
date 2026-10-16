import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Script from "next/script";
import HeroCarousel from "@/components/hero-carousel";
export default function Home() {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/homepage.html"),
    "utf8",
  );
  const body = source
    .split("<body>")[1]
    .split("</body>")[0]
    .replace('<script src="app.js"></script>', "");
  const mainStart = body.indexOf('<main id="main">');
  const heroStart = body.indexOf('<section class="hero wrap">');
  const heroEnd = body.indexOf("</section>", heroStart) + "</section>".length;
  const mainEnd = body.indexOf("</main>", heroEnd);
  return (
    <>
      <link rel="stylesheet" href="/marketing.css" />
      <div dangerouslySetInnerHTML={{ __html: body.slice(0, mainStart) }} />
      <main id="main">
        <HeroCarousel originalHero={body.slice(heroStart, heroEnd)} />
        <div
          dangerouslySetInnerHTML={{ __html: body.slice(heroEnd, mainEnd) }}
        />
      </main>
      <div
        dangerouslySetInnerHTML={{
          __html: body.slice(mainEnd + "</main>".length),
        }}
      />
      <Script
        id="real-workspace-links"
        strategy="afterInteractive"
      >{`document.addEventListener('click',function(e){const b=e.target.closest('.open-demo');if(b){e.preventDefault();e.stopImmediatePropagation();window.location.href=b.classList.contains('text-button')?'/login':'/workspace';}},true);`}</Script>
      <Script src="/marketing.js" strategy="afterInteractive" />
    </>
  );
}
