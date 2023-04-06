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
			tableDimensions: [],
			removedFields: [],
			addedMeasures: []
		},
		qHyperCubeDef: {
			qDimensions: [],
			qMeasures: [],
			qColumnOrder: [],
			qInterColumnSortOrder: [],
			qCalcCondition: {
				qCond: {
					qv: ""
				},
				qMsg: {
					qv: "Use the context menu to add fields, dimensions or measures."
				}
			}
		},
		showTitles: false,
		title: JSON.parse(qext).title,
		subtitle: ""
	};
});
