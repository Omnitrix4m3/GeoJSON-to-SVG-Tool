import babel from 'rollup-plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
  input: ['src/index.js'],
  output: [
    {
      name: 'MapboxInspector',
      file: 'bundle.js',
      format: 'umd',
      sourcemap: true
    }
  ],
  treeshake: true,
  plugins: [
    babel(),
    json(),
    resolve(),
    commonjs()
  ]
};
