// Package asichain is an xk6 extension that provides deploy signing for ASI-Chain nodes.
// It exposes the module "k6/x/asichain" to k6 scripts.
//
// Exported JS API:
//
//	import { signDeploy, helloWorldTerm, transferTerm, waitForBlock, waitForFinalization, parseDeployId } from "k6/x/asichain";
package asichain

import "go.k6.io/k6/js/modules"

func init() {
	modules.Register("k6/x/asichain", new(RootModule))
}

// RootModule is instantiated once per test run.
type RootModule struct{}

// ModuleInstance is created per VU.
type ModuleInstance struct {
	vu modules.VU
}

func (*RootModule) NewModuleInstance(vu modules.VU) modules.Instance {
	return &ModuleInstance{vu: vu}
}

func (mi *ModuleInstance) Exports() modules.Exports {
	return modules.Exports{
		Named: map[string]any{
			"signDeploy":          mi.SignDeploy,
			"helloWorldTerm":      HelloWorldTerm,
			"transferTerm":        TransferTerm,
			"waitForBlock":        WaitForBlock,
			"waitForFinalization": WaitForFinalization,
			"parseDeployId":       ParseDeployId,
		},
	}
}
