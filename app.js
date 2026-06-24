let map=L.map("map").setView([25.08,121.93],11);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap contributors"}).addTo(map);
let staMarker=null,apMarker=null,pathLine=null,clickStep=0,chart=null;

function parseCoord(text){const p=text.trim().split(/[,\s]+/).filter(Boolean);if(p.length!==2)return null;const lat=parseFloat(p[0]),lon=parseFloat(p[1]);if(isNaN(lat)||isNaN(lon))return null;return{lat,lon};}
function formatCoord(ll){return ll.lat.toFixed(8)+", "+ll.lng.toFixed(8);}
function clearObjects(){if(staMarker)map.removeLayer(staMarker);if(apMarker)map.removeLayer(apMarker);if(pathLine)map.removeLayer(pathLine);staMarker=null;apMarker=null;pathLine=null;}
function clearMapPoints(){clearObjects();document.getElementById("staCoord").value="";document.getElementById("apCoord").value="";clickStep=0;}
function redrawMap(){clearObjects();const sta=parseCoord(staCoord.value),ap=parseCoord(apCoord.value);if(sta)staMarker=L.marker([sta.lat,sta.lon]).addTo(map).bindPopup("STA");if(ap)apMarker=L.marker([ap.lat,ap.lon]).addTo(map).bindPopup("AP");if(sta&&ap){pathLine=L.polyline([[sta.lat,sta.lon],[ap.lat,ap.lon]],{weight:4}).addTo(map);map.fitBounds(pathLine.getBounds(),{padding:[40,40]});clickStep=2;}}
function setSta(ll){staCoord.value=formatCoord(ll);if(staMarker)map.removeLayer(staMarker);staMarker=L.marker(ll).addTo(map).bindPopup("STA").openPopup();}
function setAp(ll){apCoord.value=formatCoord(ll);if(apMarker)map.removeLayer(apMarker);apMarker=L.marker(ll).addTo(map).bindPopup("AP").openPopup();}
function updateLine(){if(pathLine)map.removeLayer(pathLine);const sta=parseCoord(staCoord.value),ap=parseCoord(apCoord.value);if(sta&&ap)pathLine=L.polyline([[sta.lat,sta.lon],[ap.lat,ap.lon]],{weight:4}).addTo(map);}
map.on("click",e=>{if(clickStep===0||clickStep>=2){clearMapPoints();setSta(e.latlng);clickStep=1;}else{setAp(e.latlng);updateLine();clickStep=2;}});
staCoord.addEventListener("change",redrawMap);apCoord.addEventListener("change",redrawMap);
function updateKFactor(){const v=kPreset.value;if(v!=="custom")kFactor.value=v;}

function haversineKm(a,b){const R=6371,lat1=a.lat*Math.PI/180,lat2=b.lat*Math.PI/180,dLat=(b.lat-a.lat)*Math.PI/180,dLon=(b.lon-a.lon)*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function earthBulgeM(d1m,d2m,k){return d1m*d2m/(2*6371000*k);}
function fresnelM(d1km,d2km,fGHz,totalKm){if(d1km<=0||d2km<=0)return 0;return 17.32*Math.sqrt((d1km*d2km)/(fGHz*totalKm));}
function freqs(){let f=[];document.querySelectorAll(".freqCheck:checked").forEach(e=>f.push(parseFloat(e.value)));const c=customFreqs.value.trim();if(c)c.split(/[,\s]+/).forEach(v=>{let x=parseFloat(v);if(!isNaN(x)&&x>0)f.push(x)});return[...new Set(f)];}

function analyze(){
 const sta=parseCoord(staCoord.value),ap=parseCoord(apCoord.value);if(!sta||!ap){alert("請輸入 STA / AP 座標");return;}
 const sg=parseFloat(staGround.value),ag=parseFloat(apGround.value),sa=parseFloat(staAgl.value),aa=parseFloat(apAgl.value),k=parseFloat(kFactor.value),fs=freqs();if(fs.length===0){alert("請至少勾選一個頻率");return;}
 const D=haversineKm(sta,ap),Dm=D*1000,staAnt=sg+sa,apAnt=ag+aa,N=201;
 let labels=[],terrain=[],curved=[],los=[];
 for(let i=0;i<N;i++){let t=i/(N-1),d1=Dm*t,d2=Dm-d1,g=sg+(ag-sg)*t,b=earthBulgeM(d1,d2,k),l=staAnt+(apAnt-staAnt)*t;labels.push((D*t).toFixed(2));terrain.push(g);curved.push(g+b);los.push(l);}
 let datasets=[{label:"Terrain / Sea Level",data:terrain,borderWidth:2,pointRadius:0,fill:true},{label:"LOS Line",data:los,borderWidth:2,pointRadius:0},{label:"Terrain + Earth Curvature",data:curved,borderWidth:2,pointRadius:0,borderDash:[5,5]}];
 let rows=[],overall=true,worst=null,worstF=null;
 fs.forEach(freq=>{let lower=[],min=Infinity;for(let i=0;i<N;i++){let t=i/(N-1),d1=D*t,d2=D-d1,le=los[i]-0.6*fresnelM(d1,d2,freq/1000,D),cl=le-curved[i];lower.push(le);if(cl<min)min=cl;}let mid=fresnelM(D/2,D/2,freq/1000,D),res=min>=0?"PASS":"FAIL";if(res==="FAIL")overall=false;if(worst===null||min<worst){worst=min;worstF=freq;}datasets.push({label:`60% Fresnel Lower Edge @ ${freq} MHz`,data:lower,borderWidth:2,pointRadius:0,borderDash:[8,4]});rows.push({freq,mid,mid60:mid*.6,min,res});});
 resultCard.style.display="block";chartCard.style.display="block";
 summary.innerHTML=`<div class="item"><b>Distance</b>${D.toFixed(2)} km</div><div class="item"><b>K Factor</b>${k.toFixed(2)}</div><div class="item"><b>Overall Result</b><span class="${overall?'pass':'fail'}">${overall?'PASS':'FAIL'}</span></div><div class="item"><b>STA Ant Elev</b>${staAnt.toFixed(1)} m</div><div class="item"><b>AP Ant Elev</b>${apAnt.toFixed(1)} m</div><div class="item"><b>Worst Clearance</b>${worst.toFixed(2)} m @ ${worstF} MHz</div>`;
 freqTable.innerHTML=rows.map(r=>`<tr><td>${r.freq} MHz</td><td>${r.mid.toFixed(2)} m</td><td>${r.mid60.toFixed(2)} m</td><td>${r.min.toFixed(2)} m</td><td><span class="${r.res==='PASS'?'pass':'fail'}">${r.res}</span></td></tr>`).join("");
 if(chart)chart.destroy();chart=new Chart(profileChart.getContext("2d"),{type:"line",data:{labels,datasets},options:{responsive:true,interaction:{mode:"index",intersect:false},scales:{x:{title:{display:true,text:"Distance from STA to AP (km)"}},y:{title:{display:true,text:"Height (m)"}}}}});
 redrawMap();
}
redrawMap();
