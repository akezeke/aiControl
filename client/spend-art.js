// Small vector HUD illustrations: theme-native materials, no image downloads or canvas loop.
export function spendArt() {
  const node = document.createElement('span'); node.className = 'spend-emblem'; node.setAttribute('aria-hidden', 'true');
  node.innerHTML = `<svg viewBox="0 0 120 96" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g class="spend-art modern">
    <path d="M19 22 96 13l7 57-77 10Z" fill="#7b76ec" opacity=".25"/>
    <path d="M16 29q0-7 7-7h78q7 0 7 7v48q0 7-7 7H23q-7 0-7-7Z" fill="#5d59d6" stroke="#b1acff" stroke-width="2"/>
    <path d="M17 42h90" stroke="#a39bff" stroke-width="8"/><rect x="28" y="53" width="18" height="13" rx="3" fill="#dfd7ff"/>
    <path d="M34 53v13m6-13v13m-12-6h18" stroke="#8e83be"/>
    <circle cx="85" cy="66" r="14" fill="#aca8fa"/><circle cx="85" cy="66" r="9" stroke="#eeeaff"/>
    <path d="M85 59v14m4-11c-5-5-12 1-4 4s1 8-4 3" stroke="#fff" stroke-width="1.5"/>
  </g>
  <g class="spend-art heroes"><image href="/spend-heroes.webp" width="120" height="96" preserveAspectRatio="xMidYMid meet"/></g>
  <g class="spend-art command">
    <path d="m9 73 40-17 61 17-40 17Z" fill="#1a2714" stroke="#718151"/>
    <path d="m20 67-4-29 11-13 16 15-3 29Z" fill="#50782b" stroke="#15240c" stroke-width="2"/>
    <path d="m27 25 3 39-10 3-4-29Z" fill="#b8dc54"/><path d="m30 64 13-24-16-15Z" fill="#83b63f"/>
    <path d="m43 73-3-45L56 8l19 19-9 48Z" fill="#6c9f35" stroke="#18260e" stroke-width="2"/>
    <path d="M56 8 54 70 43 73l-3-45Z" fill="#d2ed78"/><path d="m56 8 19 19-21 43Z" fill="#8fc843"/>
    <path d="m70 77 2-32 17-18 16 15-10 34Z" fill="#6d9634" stroke="#1c2b12" stroke-width="2"/>
    <path d="m89 27-8 45-11 5 2-32Z" fill="#badc59"/><path d="m89 27 16 15-24 30Z" fill="#8cb43e"/>
    <path d="m35 80 3-18 10-9 13 15-5 17Z" fill="#adc84b" stroke="#253916" stroke-width="2"/>
    <path d="m9 18 5-5m88 3 5 5M7 42v7" stroke="#d9f59c"/>
  </g>
  <g class="spend-art alien">
    <path d="M15 15h90v63H15Z" fill="#06150a" stroke="#3e8050" stroke-width="3"/>
    <path d="M22 22h76v45H22Z" stroke="#8cdba2"/><path d="M24 57h72M24 47h72M24 37h72M38 24v41M53 24v41M68 24v41M83 24v41" stroke="#245532"/>
    <path d="m25 57 13-6 12 2 15-17 14 5 15-13" stroke="#b1ffb5" stroke-width="2"/>
    <path d="M47 79v7h26v-7M38 87h44" stroke="#609b68" stroke-width="3"/>
    <path d="M23 72h25m40 0h9" stroke="#b2ffab" stroke-width="2"/>
    <circle cx="99" cy="18" r="3" fill="#9cf49b"/>
  </g>
  <g class="spend-art diablo"><image href="/spend-diablo.webp" width="120" height="96" preserveAspectRatio="xMidYMid meet"/></g>
  <g class="spend-art office">
    <path d="m19 9 64 5-5 75-7-5-7 4-7-5-7 4-7-5-7 4-7-5-7 4Z" fill="#fffef2" stroke="#b9b8a4" stroke-width="2"/>
    <path d="m29 25 37 3m-38 8 37 3m-38 8 20 2m-21 8 33 3m-34 9 23 2" stroke="#bac9d1" stroke-width="3"/>
    <rect x="68" y="38" width="39" height="49" rx="5" fill="#477384" stroke="#244857" stroke-width="2"/><path d="M74 45h27v10H74Z" fill="#d3e4c6"/>
    <path d="M75 62h5m6 0h5m5 0h5m-26 8h5m6 0h5m5 0h5m-26 8h5m6 0h5m5 0h5" stroke="#d6e2df" stroke-width="4"/>
    <path d="m18 13 17 1" stroke="#bdc8cc" stroke-width="5"/>
  </g>
  <g class="spend-art simpsons">
    <ellipse cx="60" cy="83" rx="41" ry="7" fill="#793b1a" opacity=".15"/>
    <path d="M105 47a45 37 0 1 1-90 0 45 37 0 1 1 90 0ZM75 47a15 12 0 1 0-30 0 15 12 0 1 0 30 0Z" fill="#dc973e" fill-rule="evenodd" stroke="#392b27" stroke-width="3"/>
    <path d="M102 42c-1 8-8 6-11 12-5 7-10 0-16 5-10 7-19-3-25 1-8 4-10-5-17-5-8 0-10-10-15-13C17 21 37 9 60 9s43 12 42 33ZM75 42a15 11 0 1 0-30 0 15 11 0 1 0 30 0Z" fill="#ee92b7" fill-rule="evenodd" stroke="#392b27" stroke-width="2"/>
    <path d="m32 27 5 3m45 1 5-4M55 17l5 3m27 24 5 2M34 47l6-1" stroke="#fff2a0" stroke-width="3"/>
    <path d="m43 20-4 4m28 0 5-3m-48 16 5 1m34 17 5-3m29-15 3 3" stroke="#70d6dc" stroke-width="3"/>
    <path d="m48 54 4 2m23-38 3 3" stroke="#724d9a" stroke-width="3"/>
  </g>
  <g class="spend-art bridge">
    <ellipse cx="60" cy="86" rx="40" ry="6" fill="#050818" opacity=".7"/>
    <path d="M60 6 88 34 76 76H44L32 34Z" fill="#7e45f2" stroke="#e4d4ff" stroke-width="2"/>
    <path d="M60 6 76 76H60Z" fill="#bb92ff" opacity=".75"/><path d="M60 6 32 34h28Z" fill="#d7bcff" opacity=".8"/>
    <path d="M32 34h56M46 34l14 42 14-42" stroke="#f1e7ff" stroke-width="1.5" opacity=".7"/>
    <path d="M24 78h72l8 10H16Z" fill="#232b66" stroke="#6577e6" stroke-width="2"/><path d="M30 83h60" stroke="#ff4fd1" stroke-width="2"/>
    <path d="M18 24l6 6m78-6-6 6M12 52h8m80 0h8" stroke="#49e6d6" stroke-width="2"/>
  </g>
  <g class="spend-art city" shape-rendering="crispEdges">
    <ellipse cx="60" cy="86" rx="46" ry="6" fill="#000" opacity=".4"/>
    <path d="M24 38h72v-6h-8v-6h-8v-6H40v6h-8v6h-8Z" fill="#165a4c" stroke="#2e222f" stroke-width="4"/><path d="M42 24h36M34 30h8m36 0h8" stroke="#239063" stroke-width="2"/>
    <rect x="55" y="27" width="10" height="6" fill="#8ff8e2"/>
    <path d="M18 38h84v10H18Z" fill="#fbf5ef" stroke="#2e222f" stroke-width="4"/>
    <path d="M24 48h10v26H24ZM43 48h10v26H43ZM67 48h10v26H67ZM86 48h10v26H86Z" fill="#fbf5ef" stroke="#2e222f" stroke-width="3"/><path d="M31 50v22m19-22v22m24-22v22m19-22v22" stroke="#c7dcd0" stroke-width="2"/>
    <path d="M12 74h96v10H12Z" fill="#c7dcd0" stroke="#2e222f" stroke-width="4"/><path d="M16 80h88" stroke="#9babb2" stroke-width="2"/>
  </g>
  <g class="spend-art fantasy" shape-rendering="crispEdges">
    <ellipse cx="60" cy="86" rx="46" ry="7" fill="#020a08" opacity=".65"/>
    <path d="M20 46h80v36H20Z" fill="#7b4a22" stroke="#1a100a" stroke-width="4"/>
    <path d="M20 46V36q0-22 40-22t40 22v10Z" fill="#a96b2d" stroke="#1a100a" stroke-width="4"/>
    <path d="M22 56h76M22 68h76M26 26q8-8 18-10" stroke="#3b2412" stroke-width="2"/>
    <path d="M30 18v62M90 18v62" stroke="#f0c04a" stroke-width="6"/><path d="M20 46h80" stroke="#f0c04a" stroke-width="5"/>
    <rect x="50" y="42" width="20" height="18" fill="#f7d86c" stroke="#6a4a14" stroke-width="2"/><path d="M60 47v7" stroke="#2a1a0a" stroke-width="3"/>
    <ellipse cx="14" cy="82" rx="11" ry="4" fill="#f2c94c" stroke="#7a5a14" stroke-width="2"/><ellipse cx="108" cy="80" rx="9" ry="3.5" fill="#f2c94c" stroke="#7a5a14" stroke-width="2"/>
    <path d="m96 8 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#fff0ae"/>
  </g></svg>`;
  return node;
}
