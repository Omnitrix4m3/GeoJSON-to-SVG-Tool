// Note: This needs the `fix-near-zero` branch to work correctly, once that merges, update package
import rewind from '@mapbox/geojson-rewind';
import { saveAs } from 'file-saver';
import { expression } from '@mapbox/mapbox-gl-style-spec';
import colorLib from 'color';
import get from 'lodash.get';

// It's very likely we don't need all these separate d3 libraries, but I added them while working fast
import * as d3 from 'd3';
import simplifyGeojson from 'simplify-geojson';

import { fakeFit } from './local_d3_geo';
import * as spec from './spec';

function stylePropertyValueIsExpression(value) {
  if (value === undefined || value === null) return false;
  if (!Array.isArray(value)) return false;
  return expression.isExpression(value);
}

const { createPropertyExpression } = expression;

const UNSUPPORTED_TYPES = ['fill-extrusion', 'heatmap'];
const SIZE = Math.min(window.innerWidth, window.innerHeight);

function download(item, id) {
  saveAs(
    new Blob([item], { type: 'image/svg+xml;charset=utf-8' }),
    `${id}.svg`,
    true
  );

  d3.select(`#${id}`).remove();
  // remove our scaling svg
  d3.select(`#scaleMapSvg`).remove();
}

function toHex(color) {
  return (
    colorLib(color)
      .hex()
      .toLowerCase() || color
  );
}

const comparators = ['==', '!', '!=', '<', '<=', '==', '>', '>='];

const evaluateDataExpression = (
  sourceLayer,
  propertyValue,
  featureProperties,
  zoom
) => {
  // these are hacks for the evaluator not to fail
  if (!Array.isArray(propertyValue)) return propertyValue;

  if (comparators.includes(propertyValue[0])) {
    if (
      !!propertyValue.find(
        exp =>
          evaluateDataExpression(sourceLayer, exp, featureProperties, zoom) ===
          undefined
      )
    ) {
      return false;
    }
  }

  if (propertyValue[0] === 'zoom') {
    return zoom;
  }
  if (propertyValue[0] === 'get') {
    const getVal = featureProperties[propertyValue[1]];

    if (getVal === undefined) {
      // this should return appropriately typed default, eg number => 0, string => ''
      // For now this might break with data-driven-styling. Need to know type of property
      return '';
    }

    return getVal;
  }
  if (propertyValue[0] === 'has') {
    return !!featureProperties[propertyValue[1]];
  }
  if (Array.isArray(propertyValue)) {
    return propertyValue.map(item =>
      evaluateDataExpression(sourceLayer, item, featureProperties, zoom)
    );
  }
  return propertyValue;
};

const evaluateValueForFeature = (
  sourceLayer,
  propertyId,
  propertyValue,
  feature,
  zoom
) => {
  let simpleExpression = evaluateDataExpression(
    sourceLayer,
    propertyValue,
    feature.properties,
    zoom
  );

  const propertySpecDetails = spec.getPropertySpec(propertyId).details;

  if (!Array.isArray(simpleExpression)) {
    if (typeof simpleExpression === 'string') return simpleExpression;
    return simpleExpression.sections[0].text;
  }

  let evaluatedValue = createPropertyExpression(simpleExpression, propertySpecDetails);

  if (propertyId === 'text-offset') {
    console.log(evaluatedValue);
  }

  if (!get(evaluatedValue, ['value', 'evaluate'])) {
    if (simpleExpression[0] === 'coalesce') {
      return simpleExpression.find(
        item => item !== 'coalesce' && item !== undefined && item !== null
      );
    } else {
      return propertyValue;
    }
  }

  const evaluator = evaluatedValue.value.evaluate.bind(evaluatedValue.value);
  const nextVal = evaluator(feature.properties, feature);
  return nextVal;
};

const getPropertyValue = ({ propertyId, propertyType, layer, feature, zoom }) => {
  const propertyValue = get(layer, [propertyType, propertyId])

  if (!propertyValue || !stylePropertyValueIsExpression(propertyValue))
    return propertyValue;

  const sourceLayer = layer['source-layer'];

  return evaluateValueForFeature(
    sourceLayer,
    propertyId,
    propertyValue,
    feature,
    zoom
  );
};

const assignPropertiesToSvg = ({ propertiesToAssign, svgEl, layer, feature, zoom })  => {
  Object.keys(propertiesToAssign).forEach(propertyType => {
    Object.keys(propertiesToAssign[propertyType]).forEach(propertyId => {
      let propertyValue = getPropertyValue({
        propertyId,
        propertyType,
        layer,
        feature,
        zoom
      });

      if (!propertyValue) return;

      const svgHandling = propertiesToAssign[propertyType][propertyId];

      const fn = svgHandling.svgProperty[0];
      const path = svgHandling.svgProperty.slice(1)[0];

      if (svgHandling.specialHandling) {
        propertyValue = svgHandling.specialHandling(propertyValue);
      }

      if (path) {
        propertyValue && svgEl[fn](path, propertyValue);
      } else {
        propertyValue && svgEl[fn](propertyValue);
      }
    });
  });
};

const assignPolygonProperties = (path, layer, feature, zoom) => {
  const propertiesToAssign = {
    paint: {
      'fill-color': {
        svgProperty: ['attr', 'fill'],
        specialHandling: val => toHex(val.toString())
      },
      'fill-opacity': {
        svgProperty: ['attr', 'opacity']
      }
    }
  };

  assignPropertiesToSvg({
    propertiesToAssign,
    svgEl: path,
    layer,
    feature,
    zoom
  });

  path.attr('stroke', 'none');
  return path;
};

const assignBackgroundProperties = (path, layer, feature, zoom) => {
  const propertiesToAssign = {
    paint: {
      'background-color': {
        svgProperty: ['attr', 'fill'],
        specialHandling: val => toHex(val.toString())
      },
      'background-opacity': {
        svgProperty: ['attr', 'opacity']
      }
    }
  };

  assignPropertiesToSvg({
    propertiesToAssign,
    svgEl: path,
    layer,
    feature,
    zoom
  });

  path.attr('stroke', 'none');
  return path;
};

const assignLineProperties = (path, layer, feature, zoom) => {
  const propertiesToAssign = {
    paint: {
      'line-width': { svgProperty: ['attr', 'stroke-width'] },
      'line-color': {
        svgProperty: ['attr', 'stroke'],
        specialHandling: val => toHex(val.toString())
      },
      'line-opacity': {
        svgProperty: ['attr', 'opacity']
      }
    }
  };

  assignPropertiesToSvg({
    propertiesToAssign,
    svgEl: path,
    layer,
    feature,
    zoom
  });

  path.attr('fill', 'none');
  return path;
};

const assignTextProperties = (text, layer, feature, zoom) => {
  const propertiesToAssign = {
    layout: {
      'text-field': {
        svgProperty: ['text']
      },
      'text-font': {
        svgProperty: ['attr', 'font-family'],
        specialHandling: val => val.join(',')
      },
      'text-size': { svgProperty: ['attr', 'font-size'] }
    },
    paint: { 'text-opacity': { svgProperty: ['attr', 'opacity'] } }
  };

  assignPropertiesToSvg({
    propertiesToAssign,
    svgEl: text,
    layer,
    feature,
    zoom
  });

  text.attr('text-anchor', 'middle');

  return text;
};

const assignTextStyleProperties = (text, layer, feature, zoom) => {
  const propertiesToAssign = {
    paint: {
      'text-color': {
        svgProperty: ['attr', 'fill'],
        specialHandling: val => toHex(val.toString())
      }
    }
  };

  assignPropertiesToSvg({
    propertiesToAssign,
    svgEl: text,
    layer,
    feature,
    zoom
  });

  return text;
};

const assignTextStrokeStyleProperties = (
  text,
  layer,
  feature,
  zoom,
  strokeBlurId
) => {
  const propertiesToAssign = {
    paint: {
      'text-halo-color': {
        svgProperty: ['attr', 'stroke'],
        specialHandling: val => toHex(val.toString())
      },
      'text-halo-width': {
        svgProperty: ['attr', 'stroke-width']
      }
    }
  };

  if (strokeBlurId) {
    text.attr('filter', `url(#${strokeBlurId})`);
  }

  assignPropertiesToSvg({
    propertiesToAssign,
    svgEl: text,
    layer,
    feature,
    zoom
  });

  text.attr('fill', 'none');
  return text;
};

const assignStrokeBlurToFilter = (
  filter,
  layer,
  feature,
  zoom
) => {
  const propertiesToAssign = {
    paint: {
      'text-halo-blur': {
        svgProperty: ['attr', 'stdDeviation']
      }
    }
  };

  assignPropertiesToSvg({
    propertiesToAssign,
    svgEl: filter,
    layer,
    feature,
    zoom
  });

  filter.attr('in', 'SourceGraphic').attr('stdDeviation', 5);

  return filter;
};

const mapViewToSvg = ({ map, stylesheetLayers }) => {
  const svgContainer = d3
    .select('body')
    .append('svg')
    .attr('id', 'mapSvg')
    .attr('width', `${SIZE}`)
    .attr('height', `${SIZE}`);

  const scaleSvg = d3
    .select('body')
    .append('svg')
    .attr('id', 'scaleMapSvg')
    .attr('width', `${SIZE}`)
    .attr('height', `${SIZE}`);

  // Use for all interpolated values
  const currentZoom = map.getZoom();
  const bbox = map.getBounds();

  const bboxCoords = [
    [bbox._ne.lng, bbox._ne.lat],
    [bbox._ne.lng, bbox._sw.lat],
    [bbox._sw.lng, bbox._sw.lat],
    [bbox._sw.lng, bbox._ne.lat],
    [bbox._ne.lng, bbox._ne.lat]
  ];

  const bboxGeojson = {
    id: 'bbox',
    geometry: {
      type: 'Polygon',
      coordinates: [bboxCoords]
    },
    type: 'Feature',
    properties: {}
  };

  stylesheetLayers.forEach(layer => {
    if (
      get(layer, ['layout', 'visibility']) === 'none' ||
      UNSUPPORTED_TYPES.includes(layer.type)
    ) {
      return;
    }

    let simpleGeojson = {};

    if (layer.type === 'background') {
      simpleGeojson = { type: 'FeatureCollection', features: [bboxGeojson] };
    } else {
      const geojsons = map.queryRenderedFeatures({
        layers: [layer.id]
      });

      // simpleGeojson = { type: 'FeatureCollection', features: geojsons };

      const mapFn = (value, x1, y1, x2, y2) =>
        ((value - x1) * (y2 - x2)) / (y1 - x1) + x2;
      const MIN_SIMPLIFICATION = 0.0001;
      const MAX_SIMPLIFICATION = 0.0075;
      let simplificationScale = mapFn(
        18 - currentZoom,
        5,
        13,
        MIN_SIMPLIFICATION,
        MAX_SIMPLIFICATION
      );
      simplificationScale = Math.max(
        Math.min(simplificationScale, MAX_SIMPLIFICATION),
        MIN_SIMPLIFICATION
      );

      simpleGeojson = simplifyGeojson(
        { type: 'FeatureCollection', features: geojsons },
        simplificationScale
      );
    }

    const center = map.getCenter();

    const layerGroup = svgContainer.append('g').attr('id', layer.id);

    let scale;

    function fitExtent(projection, extent, object) {
      return fakeFit(
        projection,
        function(b) {
          var w = extent[1][0] - extent[0][0],
            h = extent[1][1] - extent[0][1],
            k = Math.min(w / (b[1][0] - b[0][0]), h / (b[1][1] - b[0][1]));

          scale = 150 * k;
        },
        object
      );
    }

    const fakeProjection = fitExtent(
      d3.geoMercator(),
      [
        [0, 0],
        [SIZE, SIZE]
      ],
      bboxGeojson
    );

    // Use this for scaling / bounding box
    scaleSvg
      .append('path')
      .datum(bboxGeojson)
      .attr('d', d3.geoPath(fakeProjection));

    simpleGeojson.features.forEach(f => {
      const feature = f.id === 'bbox' ? f : rewind(f, true);

      const projection = d3
        .geoMercator()
        .center([center.lng, center.lat])
        .scale(scale)
        .translate([SIZE / 2, SIZE / 2])
        .clipExtent([
          [0, 0],
          [SIZE, SIZE]
        ]);

      switch (layer.type) {
        case 'symbol': {
          // if label is not on point, get centroid
          const getLabelPlacementFromFeature = d => {
            let coords = projection(d.geometry.coordinates);
            if (coords.length !== 2 || coords.some(c => isNaN(c))) {
              coords = d3.geoPath(projection).centroid(d);
            }
            return 'translate(' + coords + ')';
          };

          const hasStroke = !!get(layer, ['paint', 'text-halo-color']);
          const strokeBlurId =
            !!get(layer, ['paint', 'text-halo-blur']) && `${feature.id}-blur`;

          if (hasStroke) {
            if (strokeBlurId) {
              const filter = layerGroup
                .append('filter')
                .attr('id', strokeBlurId)
                .append('feGaussianBlur');

              assignStrokeBlurToFilter(filter, layer, feature, currentZoom);
            }

            let stroke = layerGroup
              .append('text')
              .datum(feature)
              .attr('class', 'place-label')
              .attr('transform', getLabelPlacementFromFeature)
              .attr('id', `${feature.id}-stroke`);
            assignTextProperties(stroke, layer, feature, currentZoom);
            assignTextStrokeStyleProperties(
              stroke,
              layer,
              feature,
              currentZoom,
              strokeBlurId
            );
          }
          let text = layerGroup
            .append('text')
            .datum(feature)
            .attr('class', 'place-label')
            .attr('transform', getLabelPlacementFromFeature)
            .attr('id', `${feature.id}-text`);
          assignTextProperties(text, layer, feature, currentZoom);
          assignTextStyleProperties(text, layer, feature, currentZoom);
          break;
        }
        case 'line': {
          let layerPath = layerGroup
            .append('path')
            .datum(feature)
            .attr('d', d3.geoPath(projection))
            .attr('id', feature.id);

          assignLineProperties(layerPath, layer, feature, currentZoom);
          break;
        }
        case 'background': {
          let layerPath = layerGroup
            .append('path')
            .datum(feature)
            .attr('d', d3.geoPath(projection))
            .attr('id', feature.id);

          assignBackgroundProperties(layerPath, layer, feature, currentZoom);
          break;
        }
        default: {
          let layerPath = layerGroup
            .append('path')
            .datum(feature)
            .attr('d', d3.geoPath(projection))
            .attr('id', feature.id);

          assignPolygonProperties(layerPath, layer, feature, currentZoom);
          break;
        }
      }
    });
  });

  const finalSvg = d3
    .select('#mapSvg')
    .attr('title', 'svg_title')
    .attr('version', 1.1)
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('viewport', `0 0 ${SIZE} ${SIZE}`)
    .attr('viewbox', `0 0 ${SIZE} ${SIZE}`)
    .node();

  const xml = new XMLSerializer().serializeToString(finalSvg);
  download(`${xml}`, 'mapSvg');
};

export { mapViewToSvg };
