/**
 * E-mergo Table Inspector Initial Properties
 *
 * @package E-mergo Tools Bundle
 *
 * @param  {String} qext          Extension QEXT data
 * @return {Object}               Initial properties
 */
define([
	"text!./qs-emergo-table-inspector.qext"
], function( qext ) {
	return {
		props: {
			tableName: false,
			tableStructure: [],
			exportDimensions: [],
			removedFields: [],
			addedMeasures: []
		},
		qHyperCubeDef: {
			qDimensions: [],
			qMeasures: [],
			qColumnOrder: [],
			qInterColumnSortOrder: []
		},
		showTitles: false,
		title: JSON.parse(qext).title,
		subtitle: ""
	};
});
