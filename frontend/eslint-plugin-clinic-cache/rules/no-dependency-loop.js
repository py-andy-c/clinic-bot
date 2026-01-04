/**
 * ESLint rule to detect React dependency loops.
 * 
 * Detects patterns where useCallback depends on state it updates.
 * This helps prevent infinite loops like the one we found where
 * refreshAvailableClinics was being called 100+ times.
 * 
 * Refined to ignore:
 * - Functional updates (setState(prev => ...))
 * - Guard patterns (if (state) return;)
 * - Read-only dependencies (reading state but not updating it)
 * - Different state variables (updating setStateA but depending on stateB)
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Detect React dependency loops in useCallback',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      dependencyLoop: 
        'useCallback depends on state it updates, which can cause infinite loops. ' +
        'Consider using useRef to store the current value, or use functional updates (setState(prev => ...)).',
    },
  },
  
  create(context) {
    const sourceCode = context.getSourceCode();
    
    // Track state setters in the file
    const stateSetters = new Set();
    const stateVariables = new Map(); // Map setter name to state variable name
    
    // First pass: find all useState setters and their corresponding state variables
    function findStateSetters(node) {
      if (!node) return;
      
      // Look for: const [state, setState] = useState(...)
      if (node.type === 'VariableDeclarator' &&
          node.init &&
          node.init.type === 'CallExpression' &&
          node.init.callee &&
          node.init.callee.type === 'Identifier' &&
          node.init.callee.name === 'useState') {
        
        if (node.id && node.id.type === 'ArrayPattern' && node.id.elements.length >= 2) {
          const stateName = node.id.elements[0];
          const setterName = node.id.elements[1];
          
          if (setterName && setterName.type === 'Identifier') {
            stateSetters.add(setterName.name);
            
            // Map setter to state variable name
            if (stateName && stateName.type === 'Identifier') {
              stateVariables.set(setterName.name, stateName.name);
            }
          }
        }
      }
      
      // Traverse children
      for (const key in node) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(findStateSetters);
        } else if (child && typeof child === 'object') {
          findStateSetters(child);
        }
      }
    }
    
    // Get all state setters from the AST
    findStateSetters(sourceCode.ast);
    
    /**
     * Check if callback uses functional update pattern
     * setState(prev => ...) or setState((prev) => ...)
     */
    function usesFunctionalUpdate(callbackBody, setterName) {
      function checkNode(node) {
        if (!node) return false;
        
        // Look for: setState(prev => ...) or setState((prev) => ...)
        if (node.type === 'CallExpression' &&
            node.callee &&
            node.callee.type === 'Identifier' &&
            node.callee.name === setterName &&
            node.arguments.length > 0) {
          
          const firstArg = node.arguments[0];
          // Check if first argument is an arrow function
          if (firstArg.type === 'ArrowFunctionExpression' ||
              firstArg.type === 'FunctionExpression') {
            return true;
          }
        }
        
        // Traverse children
        for (const key in node) {
          if (key === 'parent' || key === 'range' || key === 'loc') continue;
          const child = node[key];
          if (Array.isArray(child)) {
            for (const item of child) {
              if (checkNode(item)) return true;
            }
          } else if (child && typeof child === 'object') {
            if (checkNode(child)) return true;
          }
        }
        
        return false;
      }
      
      return checkNode(callbackBody);
    }
    
    /**
     * Check if callback has guard pattern at the start
     * if (stateVar) return; or if (!stateVar) return;
     */
    function hasGuardPattern(callbackBody, depName) {
      if (!callbackBody) return false;
      
      // Get first statement(s) in callback
      let firstStatements = [];
      if (callbackBody.type === 'BlockStatement' && callbackBody.body) {
        firstStatements = callbackBody.body.slice(0, 2); // Check first 2 statements
      } else if (callbackBody.type === 'ExpressionStatement') {
        firstStatements = [callbackBody];
      }
      
      for (const stmt of firstStatements) {
        // Look for: if (depName) return; or if (!depName) return;
        if (stmt.type === 'IfStatement' &&
            stmt.test &&
            stmt.consequent) {
          
          // Check if test references the dependency
          const testText = sourceCode.getText(stmt.test);
          const testMatches = testText.includes(depName);
          
          // Check if consequent is a return statement
          const isReturn = stmt.consequent.type === 'ReturnStatement' ||
            (stmt.consequent.type === 'BlockStatement' &&
             stmt.consequent.body.length > 0 &&
             stmt.consequent.body[0].type === 'ReturnStatement');
          
          if (testMatches && isReturn) {
            return true;
          }
        }
      }
      
      return false;
    }
    
    /**
     * Check if dependency is only read, not updated
     * Returns true if dependency is read but the corresponding setter is not called
     */
    function isReadOnlyDependency(callbackBody, depName, calledSetters, stateVariables) {
      // Check if this dependency corresponds to a state variable
      // If we depend on stateVar but only call setOtherState, it's read-only
      const stateVarName = depName;
      
      // Check if any called setter corresponds to this state variable
      for (const setterName of calledSetters) {
        const correspondingState = stateVariables.get(setterName);
        if (correspondingState === stateVarName) {
          return false; // We're updating the state we depend on
        }
      }
      
      // Also check if dependency is a member expression (e.g., modalState.data)
      // If we depend on modalState.data but update modalState (different property), it's read-only
      // This is harder to detect, so we'll be conservative
      
      return true; // No setter found for this dependency
    }
    
    return {
      CallExpression(node) {
        // Only check useCallback calls
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'useCallback') {
          return;
        }
        
        // Get the callback function (first argument)
        const callbackFn = node.arguments[0];
        if (!callbackFn || 
            (callbackFn.type !== 'ArrowFunctionExpression' && 
             callbackFn.type !== 'FunctionExpression')) {
          return;
        }
        
        // Get dependencies (second argument)
        const deps = node.arguments[1];
        if (!deps || deps.type !== 'ArrayExpression') {
          return;
        }
        
        // Check if callback calls any state setters
        const calledSetters = new Set();
        function findSetStateCalls(node) {
          if (!node) return;
          
          // Look for: setState(...) or setAuthState(...)
          if (node.type === 'CallExpression' &&
              node.callee &&
              node.callee.type === 'Identifier') {
            const funcName = node.callee.name;
            if (stateSetters.has(funcName)) {
              calledSetters.add(funcName);
            }
          }
          
          // Traverse children
          for (const key in node) {
            if (key === 'parent' || key === 'range' || key === 'loc') continue;
            const child = node[key];
            if (Array.isArray(child)) {
              child.forEach(findSetStateCalls);
            } else if (child && typeof child === 'object') {
              findSetStateCalls(child);
            }
          }
        }
        
        findSetStateCalls(callbackFn);
        
        // If callback updates state, check dependencies
        if (calledSetters.size > 0) {
          // Extract dependency names
          const depNames = new Set();
          deps.elements.forEach(element => {
            if (!element) return;
            
            if (element.type === 'Identifier') {
              depNames.add(element.name);
            } else if (element.type === 'MemberExpression') {
              // Handle: user.active_clinic_id - extract the object name
              if (element.object && element.object.type === 'Identifier') {
                depNames.add(element.object.name);
              }
            } else if (element.type === 'ChainExpression') {
              // Handle: user?.active_clinic_id
              const memberExpr = element.expression;
              if (memberExpr && memberExpr.type === 'MemberExpression' &&
                  memberExpr.object && memberExpr.object.type === 'Identifier') {
                depNames.add(memberExpr.object.name);
              }
            }
          });
          
          // Check each setter that's called
          for (const setterName of calledSetters) {
            const correspondingState = stateVariables.get(setterName);
            
            // Skip if using functional update
            if (usesFunctionalUpdate(callbackFn.body, setterName)) {
              continue; // Safe - using functional update
            }
            
            // Check if this setter's state is in dependencies
            if (correspondingState && depNames.has(correspondingState)) {
              // Check for guard pattern
              if (hasGuardPattern(callbackFn.body, correspondingState)) {
                continue; // Safe - guard pattern
              }
              
              // Check if read-only (depends on state but updates different state)
              if (isReadOnlyDependency(callbackFn.body, correspondingState, calledSetters, stateVariables)) {
                continue; // Safe - read-only dependency
              }
              
              // This is a potential dependency loop
              context.report({
                node: node.callee,
                messageId: 'dependencyLoop',
              });
              return; // Only report once per useCallback
            }
            
            // Also check if setter name itself is in dependencies (less common)
            if (depNames.has(setterName)) {
              // Check for guard pattern
              if (hasGuardPattern(callbackFn.body, setterName)) {
                continue; // Safe - guard pattern
              }
              
              // Check if using functional update
              if (usesFunctionalUpdate(callbackFn.body, setterName)) {
                continue; // Safe - functional update
              }
              
              // This is a potential dependency loop
              context.report({
                node: node.callee,
                messageId: 'dependencyLoop',
              });
              return; // Only report once per useCallback
            }
          }
        }
      },
    };
  },
};
