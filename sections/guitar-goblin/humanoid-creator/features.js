// What each species adds to the shared head, as shapes (see head-field.js `extra`). Pure: the workers import it.
// args: the same plain object the meshing jobs get ({ species, spurs, tendrils, ridges, ... }).
import { purebloodExtra } from './pureblood.js';
export const extraFor = (o) => (o && o.species === 'pureblood' ? purebloodExtra(o) : null);
