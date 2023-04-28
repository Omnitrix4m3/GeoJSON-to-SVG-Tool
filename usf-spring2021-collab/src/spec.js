import { latest as latestSpec } from '@mapbox/mapbox-gl-style-spec';

const excludedFromFormula = [
  'accumulated',
  'collator',
  'format',
  'resolved-locale',
  'line-progress',
  'heatmap-density',
  'is-supported-script',
  'in',
  'image',
  'distance',
  'within'
];

let indexedProperties = {};
let indexedExpressions = {};
let propertyLayerTypes = {};
let groupedExpressionsForFormula = {};

const getSpecWithAmpersand = () => {
  const specWithAmpersand = { ...latestSpec };

  specWithAmpersand.expression_name.values['&'] = {
    ...specWithAmpersand.expression_name.values.concat,
    doc:
      'Use to combine two strings. For example `"country: " & get("name")` would resolve to "country: Canada".'
  };

  return specWithAmpersand;
};

function initSpec(spec = latestSpec) {
  ['layout', 'paint'].forEach(propertyType => {
    spec[propertyType].forEach(groupId => {
      const layerType = groupId.split('_')[1];
      Object.keys(spec[groupId]).forEach(propertyId => {
        indexedProperties[propertyId] = {
          id: propertyId,
          // Ensure the spec is not mutated
          details: JSON.parse(JSON.stringify(spec[groupId][propertyId])),
          propertyType
        };
        propertyLayerTypes[propertyId] = layerType;
      });
    });
  });
  Object.keys(spec.light).forEach(prop => {
    const layerType = 'light';
    const propertyType = 'light';
    const propertyId = `light-${prop}`;
    indexedProperties[propertyId] = {
      id: propertyId,
      // Ensure the spec is not mutated
      details: JSON.parse(JSON.stringify(spec.light[prop])),
      propertyType
    };
    propertyLayerTypes[propertyId] = layerType;
  });

  indexedProperties.filter = {
    id: 'filter',
    details: { ...spec.filter, ...{
      'sdk-support': {
        'data-driven styling': {}
      }
    }},
    propertyType: 'filter'
  };

  const expressions = getSpecWithAmpersand().expression_name.values;
  Object.keys(expressions).forEach(name => {
    const expression = expressions[name];
    // indexedExpressions should only contain real spec expressions
    if (name !== '&' && name !== 'is-supported-script') {
      indexedExpressions[name] = {
        id: name,
        sdkSupport: {
          ...expression['sdk-support']['basic functionality']
        }
      };
    }

    if (groupedExpressionsForFormula[expression.group]) {
      if (excludedFromFormula.indexOf(name) !== -1) return;
      groupedExpressionsForFormula[expression.group] = groupedExpressionsForFormula[expression.group].concat([{ name, ...expression }]);
    } else {
      groupedExpressionsForFormula[expression.group] = [{ name, ...expression }];
    }
  });
}

function getPropertySpec(propertyId) {
  return indexedProperties[propertyId];
}

initSpec();

export { getPropertySpec };
