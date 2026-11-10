#!/usr/bin/env bash
# Download the (SIL OFL) fonts used by the renderer from the google/fonts repository and
# cut static instances out of the variable fonts (needs: pip install fonttools).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/fonts
B=https://raw.githubusercontent.com/google/fonts/main/ofl

dl() { # <path in google/fonts/ofl> <output name>
  if [[ -s "assets/fonts/$2" ]]; then echo "skip  $2"; return; fi
  echo "fetch $2"
  curl -fSL --retry 4 -o "assets/fonts/$2" "$B/$1"
}

dl delagothicone/DelaGothicOne-Regular.ttf          DelaGothicOne-Regular.ttf
dl shipporiminchob1/ShipporiMinchoB1-ExtraBold.ttf  ShipporiMinchoB1-ExtraBold.ttf
dl dotgothic16/DotGothic16-Regular.ttf              DotGothic16-Regular.ttf
dl zenkakugothicnew/ZenKakuGothicNew-Black.ttf      ZenKakuGothicNew-Black.ttf
dl bebasneue/BebasNeue-Regular.ttf                  BebasNeue-Regular.ttf
dl sharetechmono/ShareTechMono-Regular.ttf          ShareTechMono-Regular.ttf
dl "notosanssc/NotoSansSC%5Bwght%5D.ttf"            NotoSansSC-VF.ttf
dl "notoserifsc/NotoSerifSC%5Bwght%5D.ttf"          NotoSerifSC-VF.ttf
dl "antonio/Antonio%5Bwght%5D.ttf"                  Antonio-VF.ttf
dl courierprime/CourierPrime-Bold.ttf               CourierPrime-Bold.ttf

inst() { # <variable font> <wght> <output name>
  if [[ -s "assets/fonts/$3" ]]; then echo "skip  $3"; return; fi
  echo "cut   $3 (wght=$2)"
  python3 -I -m fontTools.varLib.instancer "assets/fonts/$1" "wght=$2" -q -o "assets/fonts/$3"
}

inst NotoSansSC-VF.ttf  500 NotoSansSC-Medium.ttf
inst NotoSansSC-VF.ttf  700 NotoSansSC-Bold.ttf
inst NotoSerifSC-VF.ttf 900 NotoSerifSC-Black.ttf
inst NotoSerifSC-VF.ttf 600 NotoSerifSC-SemiBold.ttf
inst Antonio-VF.ttf     300 Antonio-Light.ttf
inst Antonio-VF.ttf     700 Antonio-Bold.ttf
