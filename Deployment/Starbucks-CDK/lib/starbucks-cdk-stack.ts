import * as cdk from '@aws-cdk/core';
import * as ecr from '@aws-cdk/aws-ecr';
import ec2 = require('@aws-cdk/aws-ec2');
import elasticache = require('@aws-cdk/aws-elasticache');
import * as iam from '@aws-cdk/aws-iam';
import { Peer } from '@aws-cdk/aws-ec2';

/**
 * [2021-04-22] KSH: Added for EKS.
 */
import * as eks from '@aws-cdk/aws-eks';
import { EKSClusterStack } from './eks-cluster-stack';

// [2021-04-17] KSH: Separte this to different child module.
const PAYMENT_WEB_DOCKER_IMAGE_PREFIX = 'starbucks/payment-web';
const CODECOMMIT_REPO_NAME = "StarbucksECRSource";


export class StarbucksCdkStack extends cdk.Stack {

	readonly ecrRepository: ecr.Repository;
	readonly ecClusterReplicationGroup: elasticache.CfnReplicationGroup;
	readonly eksClusterStack: EKSClusterStack;

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

		// Create a VPC.
		const vpc = new ec2.Vpc(this, 'StarbucksVPC', {
			cidr: '10.1.0.0/16',
			natGateways: 1
		});

		this.ecrRepository = new ecr.Repository(this, 'ECRRepository', {
			repositoryName: PAYMENT_WEB_DOCKER_IMAGE_PREFIX,
			removalPolicy: cdk.RemovalPolicy.DESTROY
		});

		const buildRole = new iam.Role(this, 'CodeBuildIamRole', {
			assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com')
		});
		buildRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AWSLambda_FullAccess"));
		buildRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonAPIGatewayAdministrator"));

		buildRole.addToPolicy(new iam.PolicyStatement({
			resources: ['*'],
			actions: ['cloudformation:*']
		}));

		buildRole.addToPolicy(new iam.PolicyStatement({
			resources: ['*'],
			actions: ['iam:*']
		}));

		buildRole.addToPolicy(new iam.PolicyStatement({
			resources: ['*'],
			actions: ['ecr:GetAuthorizationToken']
		}));

		buildRole.addToPolicy(new iam.PolicyStatement({
			resources: [`${this.ecrRepository.repositoryArn}*`],
			actions: ['ecr:*']
		}));

		// ECR LifeCycles
		// repository.addLifecycleRule({ tagPrefixList: ['prod'], maxImageCount: 9999 });
		this.ecrRepository.addLifecycleRule({ maxImageAge: cdk.Duration.days(30) });

		/**
		 * [2021-04-22] KSH
		 * TODO: Put CI/CD chains from this line.
		 */

		/**
		 * [2021-04-17] KSH: Elasticache Redis
		 */
		// Security Group.
		const ecSecurityGroup = new ec2.SecurityGroup(
			this,
			'ElasticacheSG',
			{
				vpc: vpc,
				description: 'SecurityGroup associated with the Elasticache Redis Cluster',
				allowAllOutbound: true		// [2021-04-18] TODO: Restrict outbound also.
			}
		);
		// TODO: Replace the source IP from the relevant one, such as Papaya server.
		ecSecurityGroup.connections.allowFrom(Peer.ipv4("10.0.25.94/32"), ec2.Port.tcp(6379), 'Redis ingress 6379');

		let privateSubnets: string[] = [];
		vpc.privateSubnets.forEach(
			function(value) {
				privateSubnets.push(value.subnetId)
			}
		);

		const ecSubnetGroup = new elasticache.CfnSubnetGroup(
			this,
			"RedisClusterPrivateSubnetGroup",
			{
				description: "Elasticache Subnet Group",
				subnetIds: privateSubnets,
				cacheSubnetGroupName: "RedisSubnetGroup",
			}
		);

		this.ecClusterReplicationGroup = new elasticache.CfnReplicationGroup(
			this,
			"RedisReplicaGroup",
			{
				replicationGroupDescription: "RedisReplicationGroup",
				// atRestEncryptionEnabled: true,
				multiAzEnabled: true,
				cacheNodeType: "cache.m5.xlarge",
				cacheSubnetGroupName: ecSubnetGroup.cacheSubnetGroupName,
				engine: "Redis",
				// engineVersion: '6.x',
				numNodeGroups: 1,
				// kmsKeyId: ecKmsKey.keyId,
				replicasPerNodeGroup: 1,
				securityGroupIds: [ecSecurityGroup.securityGroupId],
				// automaticFailoverEnabled: true,
				// autoMinorVersionUpgrade: true,
				// transitEncryptionEnabled: true,				
			}
		);
		this.ecClusterReplicationGroup.addDependsOn(ecSubnetGroup);

		/**
		 * [2021-03-14 15:44:59]: KSH
		 * Create EKS Cluster.
		 */
		this.eksClusterStack = new EKSClusterStack(this, 'StarbucksEKSCluster', vpc, props);


		// Print outputs.
		// Stack
		new cdk.CfnOutput(this, 'StackId', {
			value: this.stackId
		});

		new cdk.CfnOutput(this, 'StackName', {
			value: this.stackName
		});

		// VPC.
		new cdk.CfnOutput(this, 'VPCCidr', {
			value: vpc.vpcCidrBlock
		});

		// ECR.
		new cdk.CfnOutput(this, 'ECRName', {
			value: this.ecrRepository.repositoryName
		});

		new cdk.CfnOutput(this, 'ECRArn', {
			value: this.ecrRepository.repositoryArn
		});

		let codeCommitHint = `
Create a "imagedefinitions.json" file and git add/push into CodeCommit repository "${CODECOMMIT_REPO_NAME}" with the following value:

[
  {
    "name": "defaultContainer",
    "imageUri": "${this.ecrRepository.repositoryUri}:latest"
  }
]
`;

		// CodeCommit.
		new cdk.CfnOutput(this, 'Hint', {
			value: codeCommitHint
		});

		// Redis.
		new cdk.CfnOutput(this, 'RedisURL', {
			value: this.ecClusterReplicationGroup.attrPrimaryEndPointAddress
		});

		new cdk.CfnOutput(this, 'RedisPort', {
			value: this.ecClusterReplicationGroup.attrPrimaryEndPointPort
		});

		// EKS.
		new cdk.CfnOutput(this, 'EKSClusterStackName', {
			value: this.eksClusterStack.stackName
		});
  }
}
