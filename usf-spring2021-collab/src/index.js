import { mapViewToSvg } from './map_view_to_svg';
import style from './stylesheet/streets-v11.json';

mapboxgl.accessToken = 'pk.eyJ1IjoiYXBhcmxhdG8iLCJhIjoiY2lzdWt3NDExMGJjeDJucWdlZjlhejg2cSJ9.Q7H91w3CryPadhz9joVezw';

const map = new mapboxgl.Map({
  container: 'map',
  style
});

map.on('load', () => {
  const container = map.getContainer();
  const button = document.createElement('button');

  button.innerText = 'Download SVG';
  button.style.position = 'absolute';
  button.style.zIndex = 2;
  button.style.margin = '10px';

  button.addEventListener('click', () => {
    mapViewToSvg({
      map,
      stylesheetLayers: style.layers
    });
  });

  container.appendChild(button);
});
