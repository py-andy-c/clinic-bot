/**
 * ESLint plugin for clinic-specific cache key validation
 * 
 * Warns when clinic-specific endpoints are used with useApiData
 * without explicit activeClinicId in dependencies.
 * 
 * Note: This is a warning (not error) because Option 1 auto-injection
 * handles it automatically. This rule serves as education and catches edge cases.
 */

// Clinic-specific method names (must match useApiData.ts)
// NOTE: Keep this list in sync with CLINIC_SPECIFIC_METHODS in frontend/src/hooks/useApiData.ts
// When adding new clinic-specific endpoints, update both locations.
const CLINIC_SPECIFIC_METHODS = new Set([
  'getClinicSettings',
  'getMembers',
  'getPractitioners',
  'getServiceTypeGroups',
  'getAutoAssignedAppointments',
  'getDashboardMetrics',
  'getBatchPractitionerStatus',
  'getPractitionerStatus',
  'getClinicInfo',
]);

// Clinic-specific URL patterns
const CLINIC_SPECIFIC_URL_PATTERNS = [
  /^\/clinic\//,
  /^\/appointments/,
  /^\/patients/,
  /^\/dashboard\/metrics/,
  /^\/liff\/clinic-info/,
];

/**
 * Extract method name from function call
 */
function extractMethodName(node) {
  if (!node || !node.callee) return null;
  
  // Handle: apiService.getClinicSettings()
  if (node.callee.type === 'MemberExpression' && 
      node.callee.property && 
      node.callee.property.type === 'Identifier') {
    return node.callee.property.name;
  }
  
  // Handle: sharedFetchFunctions.getClinicSettings()
  if (node.callee.type === 'MemberExpression' &&
      node.callee.property &&
      node.callee.property.type === 'Identifier') {
    return node.callee.property.name;
  }
  
  return null;
}

/**
 * Extract URL from function string (basic pattern matching)
 */
function extractUrlFromFunction(functionString) {
  if (typeof functionString !== 'string') return null;
  
  // Match: this.client.get('/clinic/settings')
  const urlMatch = functionString.match(/\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/);
  if (urlMatch && urlMatch[2]) {
    return urlMatch[2];
  }
  
  return null;
}

/**
 * Check if endpoint is clinic-specific
 */
function isClinicSpecific(methodName, functionString) {
  // Check method name
  if (methodName && CLINIC_SPECIFIC_METHODS.has(methodName)) {
    return true;
  }
  
  // Check URL pattern
  const url = extractUrlFromFunction(functionString);
  if (url && CLINIC_SPECIFIC_URL_PATTERNS.some(pattern => pattern.test(url))) {
    return true;
  }
  
  return false;
}

/**
 * Check if dependencies array includes activeClinicId or user?.active_clinic_id
 */
function hasClinicIdInDependencies(dependenciesNode) {
  if (!dependenciesNode || !Array.isArray(dependenciesNode.elements)) {
    return false;
  }
  
  return dependenciesNode.elements.some(element => {
    if (!element) return false;
    
    // Check for: activeClinicId
    if (element.type === 'Identifier' && element.name === 'activeClinicId') {
      return true;
    }
    
    // Check for: user?.active_clinic_id
    if (element.type === 'MemberExpression' || 
        element.type === 'ChainExpression') {
      const memberExpr = element.type === 'ChainExpression' 
        ? element.expression 
        : element;
      
      if (memberExpr.type === 'MemberExpression' &&
          memberExpr.object &&
          memberExpr.object.type === 'Identifier' &&
          memberExpr.object.name === 'user' &&
          memberExpr.property &&
          memberExpr.property.type === 'Identifier' &&
          memberExpr.property.name === 'active_clinic_id') {
        return true;
      }
    }
    
    return false;
  });
}

module.exports = {
  rules: {
    'require-clinic-id-in-deps': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Warn when clinic-specific endpoints are used without explicit activeClinicId in dependencies',
          category: 'Best Practices',
          recommended: true,
        },
        fixable: null,
        schema: [],
        messages: {
          missingClinicId: 
            'Clinic-specific endpoint "{{method}}" detected. ' +
            'Consider adding activeClinicId to dependencies for clarity. ' +
            '(Note: Auto-injection handles this automatically, but explicit inclusion is recommended for maintainability)',
        },
      },
      
      create(context) {
        return {
          CallExpression(node) {
            // Only check useApiData calls
            if (node.callee.type !== 'Identifier' || 
                node.callee.name !== 'useApiData') {
              return;
            }
            
            // Get the fetch function (first argument)
            const fetchFnArg = node.arguments[0];
            if (!fetchFnArg) return;
            
            // Get options (second argument)
            const optionsArg = node.arguments[1];
            if (!optionsArg || optionsArg.type !== 'ObjectExpression') {
              return;
            }
            
            // Find dependencies property
            let dependenciesNode = null;
            for (const property of optionsArg.properties) {
              if (property.type === 'Property' &&
                  property.key &&
                  property.key.type === 'Identifier' &&
                  property.key.name === 'dependencies') {
                dependenciesNode = property.value;
                break;
              }
            }
            
            // Extract method name from fetch function
            let methodName = null;
            let functionString = null;
            
            // Try to extract from arrow function: () => apiService.getClinicSettings()
            if (fetchFnArg.type === 'ArrowFunctionExpression' &&
                fetchFnArg.body &&
                fetchFnArg.body.type === 'CallExpression') {
              methodName = extractMethodName(fetchFnArg.body);
              // Try to get function string from source
              const sourceCode = context.getSourceCode();
              functionString = sourceCode.getText(fetchFnArg);
            }
            
            // Try to extract from function expression
            if (fetchFnArg.type === 'FunctionExpression' &&
                fetchFnArg.body &&
                fetchFnArg.body.body &&
                fetchFnArg.body.body.length > 0) {
              const returnStatement = fetchFnArg.body.body.find(
                stmt => stmt.type === 'ReturnStatement' && stmt.argument
              );
              if (returnStatement && returnStatement.argument.type === 'CallExpression') {
                methodName = extractMethodName(returnStatement.argument);
                const sourceCode = context.getSourceCode();
                functionString = sourceCode.getText(fetchFnArg);
              }
            }
            
            // Try to extract from identifier (e.g., sharedFetchFunctions.getClinicSettings)
            if (fetchFnArg.type === 'Identifier') {
              // Look for variable declaration
              const scope = context.getScope();
              const variable = scope.variables.find(v => v.name === fetchFnArg.name);
              if (variable && variable.defs.length > 0) {
                const def = variable.defs[0];
                if (def.node && def.node.init) {
                  if (def.node.init.type === 'CallExpression') {
                    methodName = extractMethodName(def.node.init);
                  } else if (def.node.init.type === 'MemberExpression' &&
                             def.node.init.property &&
                             def.node.init.property.type === 'Identifier') {
                    methodName = def.node.init.property.name;
                  }
                }
              }
            }
            
            // Check if it's a clinic-specific endpoint
            if (!isClinicSpecific(methodName, functionString)) {
              return;
            }
            
            // Check if activeClinicId is already in dependencies
            if (hasClinicIdInDependencies(dependenciesNode)) {
              return; // Already included, no warning needed
            }
            
            // Warn if clinic-specific but no activeClinicId in dependencies
            context.report({
              node: node.callee,
              messageId: 'missingClinicId',
              data: {
                method: methodName || 'unknown',
              },
            });
          },
        };
      },
    },
  },
};

