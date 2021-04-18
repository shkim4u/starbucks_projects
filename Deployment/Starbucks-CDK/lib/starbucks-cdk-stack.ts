import * as cdk from '@aws-cdk/core';
import * as ecr from '@aws-cdk/aws-ecr';
import ec2 = require('@aws-cdk/aws-ec2');
import elasticache = require('@aws-cdk/aws-elasticache');
import { Peer } from '@aws-cdk/aws-ec2';

// [2021-04-17] KSH: Separte this to different child module.
const PAYMENT_WEB_DOCKER_IMAGE_PREFIX = 'starbucks/payment-web';
const CODECOMMIT_REPO_NAME = "StarbucksECRSource";


export class StarbucksCdkStack extends cdk.Stack {

	readonly ecrRepository: ecr.Repository;

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

		/**
		 * [2021-04-17] KSH
		 * TODO: More elaborations for ECR.
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

		let publicSubnets: string[] = [];
		vpc.publicSubnets.forEach(
			function(value) {
				publicSubnets.push(value.subnetId)
			}
		);

		const ecSubnetGroup = new elasticache.CfnSubnetGroup(
			this,
			"RedisClusterPrivateSubnetGroup",
			{
				description: "Elasticache Subnet Group",
				subnetIds: publicSubnets,
				cacheSubnetGroupName: "RedisSubnetGroup",
			}
		);

		const ecClusterReplicationGroup = new elasticache.CfnReplicationGroup(
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
		ecClusterReplicationGroup.addDependsOn(ecSubnetGroup);
  }
}
